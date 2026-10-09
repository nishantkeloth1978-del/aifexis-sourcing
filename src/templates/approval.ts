import type { Pool } from "pg";
import { audit, withTenant } from "@/authz";
import type { Who } from "@/events/service";
import { diffContent, type Change } from "./lifecycle";
import type { TOut } from "./service";
import type { TemplateContent } from "./types";

export interface PendingTemplate { key: string; title: string; version: number; submittedBy: string; submittedByMe: boolean; submittedAt: string; note: string; changes: Change[]; first: boolean }

const bad = (error: string) => ({ ok: false as const, error });

export async function approvalRequired(pool: Pool, who: Who): Promise<boolean> {
  return withTenant(pool, who.tenantId, async (c) => !!(await c.query(`select approval_required from company_template_policy`)).rows[0]?.approval_required);
}

export async function setApprovalRequired(pool: Pool, who: Who, on: boolean): Promise<TOut> {
  if (who.role !== "admin") return bad("Only an administrator can change this setting.");
  return withTenant(pool, who.tenantId, async (c) => {
    await c.query(`insert into company_template_policy (tenant_id, approval_required, updated_by) values ($1,$2,$3) on conflict (tenant_id) do update set approval_required = excluded.approval_required, updated_by = excluded.updated_by, updated_at = now()`, [who.tenantId, on, who.membershipId]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, "company.template_approval_setting", { on });
    return { ok: true as const };
  });
}

export async function listPendingTemplates(pool: Pool, who: Who): Promise<PendingTemplate[]> {
  if (who.role !== "admin") return [];
  return withTenant(pool, who.tenantId, async (c) => {
    const rows = (await c.query(`select a.template_key, a.version, a.submitted_by, a.submitted_at::text as at, t.title_en, v.content,
        (select content from company_template_version p where p.template_key = a.template_key and p.version < a.version order by p.version desc limit 1) as prev,
        v.change_note
      from company_template_approval a
      join company_template_version v on v.template_key = a.template_key and v.version = a.version
      join company_template t on t.key = a.template_key
      where a.status = 'pending' order by a.submitted_at`)).rows;
    return rows.map((r) => ({
      key: r.template_key, title: r.title_en, version: r.version, submittedBy: r.submitted_by, submittedByMe: r.submitted_by === who.membershipId,
      submittedAt: r.at, note: r.change_note, first: !r.prev,
      changes: r.prev ? diffContent(r.prev as TemplateContent as never, r.content as TemplateContent as never) : [] }));
  });
}

/** A different administrator approves or rejects a pending version. */
export async function decideTemplate(pool: Pool, who: Who, key: string, version: number, approve: boolean, note = ""): Promise<TOut> {
  if (who.role !== "admin") return bad("Only an administrator can approve templates.");
  if (!Number.isInteger(version) || version < 1) return bad("That template version was not found.");
  if (!approve && note.trim().length < 5) return bad("Say why you are rejecting it (at least 5 characters).");
  return withTenant(pool, who.tenantId, async (c) => {
    const a = (await c.query(`select status, submitted_by from company_template_approval where template_key = $1 and version = $2 for update`, [key, version])).rows[0];
    if (!a) return bad("That template version was not found.");
    if (a.status !== "pending") return bad("That version has already been decided.");
    if (a.submitted_by === who.membershipId) return bad("A different administrator must approve this template.");
    await c.query(`update company_template_approval set status = $3, decided_by = $4, decided_at = now(), note = $5 where template_key = $1 and version = $2`, [key, version, approve ? "approved" : "rejected", who.membershipId, note.trim().slice(0, 500)]);
    await audit(c, { kind: "internal", tenantId: who.tenantId, userId: who.userId }, null, approve ? "company.template_approved" : "company.template_rejected", { key, version });
    return { ok: true as const };
  });
}
