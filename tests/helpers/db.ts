import { Client, Pool } from "pg";
import { randomUUID } from "node:crypto";
import { STATE_ORDER, reached, type EventState } from "@/authz";

export const dbUrl = () => process.env.TEST_DATABASE_URL!;

export async function adminClient(): Promise<Client> {
  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  return c;
}
export const makePool = (max = 5) => new Pool({ connectionString: dbUrl(), max });

export interface Person { userId: string; membershipId: string }
export interface Supplier { id: string; supplierUserId: string; userId: string }
export interface World {
  tenantId: string;
  people: Record<"buyer" | "techA" | "techB" | "comm" | "pubApprover" | "techApprover" | "awardApprover" | "witness" | "auditor" | "admin" | "integ" | "requester" | "delegate", Person>;
  suppliers: [Supplier, Supplier, Supplier];
}

async function person(c: Client, tenantId: string, email: string, role = "member"): Promise<Person> {
  const u = await c.query(`insert into app_user (email) values ($1) returning id`, [`${email}-${randomUUID()}@test.local`]);
  const m = await c.query(`insert into membership (tenant_id, user_id, role) values ($1, $2, $3) returning id`, [tenantId, u.rows[0].id, role]);
  return { userId: u.rows[0].id, membershipId: m.rows[0].id };
}

/** One tenant with the full cast of people and three invited suppliers. Runs as superuser (bypasses RLS) for fixtures only. */
export async function seedTenant(c: Client, name: string): Promise<World> {
  const t = await c.query(`insert into tenant (name) values ($1) returning id`, [name]);
  const tenantId: string = t.rows[0].id;
  const p = (e: string, role?: string) => person(c, tenantId, e, role);
  const people = {
    buyer: await p("buyer"), techA: await p("techA"), techB: await p("techB"), comm: await p("comm"),
    pubApprover: await p("pubApprover"), techApprover: await p("techApprover"), awardApprover: await p("awardApprover"),
    witness: await p("witness"), auditor: await p("auditor"), admin: await p("admin", "admin"), integ: await p("integ", "integration_admin"),
    requester: await p("requester"), delegate: await p("delegate"),
  };
  const sup: Supplier[] = [];
  for (const n of [1, 2, 3]) {
    const s = await c.query(`insert into supplier_org (tenant_id, name) values ($1, $2) returning id`, [tenantId, `Supplier ${n}`]);
    const u = await c.query(`insert into app_user (email) values ($1) returning id`, [`supplier${n}-${randomUUID()}@test.local`]);
    const su = await c.query(`insert into supplier_user (tenant_id, supplier_id, user_id) values ($1, $2, $3) returning id`, [tenantId, s.rows[0].id, u.rows[0].id]);
    sup.push({ id: s.rows[0].id, supplierUserId: su.rows[0].id, userId: u.rows[0].id });
  }
  await c.query(`insert into tenant_config (tenant_id, version, model) values ($1, 1, '{"model":"equipment_tco","version":1}')`, [tenantId]);
  return { tenantId, people, suppliers: sup as [Supplier, Supplier, Supplier] };
}

export const SECRET = "COMMERCIAL_SECRET";

export interface EventIds {
  id: string;
  objects: { d6: string[]; d7: string[] };
}

/**
 * Create an event in the given state with members, invitations, bids (D6/D7 plus derived D8/D9), stored documents,
 * clarifications, scores and results. Envelope flags and the qualified list follow the state, as the real flow would set them.
 * Suppliers 1 and 2 are qualified; supplier 3 is not.
 */
export async function makeEvent(
  c: Client, w: World, state: EventState,
  o: { pendingAwardApprovals?: number; closesAt?: string | null; invite?: number[]; withBids?: boolean } = {},
): Promise<EventIds> {
  const env1 = reached(state, "technical_evaluation");
  const env2 = reached(state, "commercial_evaluation");
  const e = await c.query(
    `insert into sourcing_event (tenant_id, title, state, envelope1_opened_at, envelope2_opened_at, closes_at, required_award_approvals, value_aed)
     values ($1, $2, $3, $4, $5, $6, $7, 400000) returning id`,
    [w.tenantId, `Event in ${state}`, state, env1 ? new Date() : null, env2 ? new Date() : null,
      o.closesAt === undefined ? (state === "published" ? new Date(Date.now() + 86400000) : new Date(Date.now() - 86400000)) : o.closesAt,
      o.pendingAwardApprovals ?? 1]);
  const id: string = e.rows[0].id;
  const P = w.people;
  const members: [keyof World["people"], string][] = [
    ["requester", "requester"], ["buyer", "buyer"], ["techA", "tech_evaluator"], ["techB", "tech_evaluator"],
    ["comm", "comm_evaluator"], ["pubApprover", "publication_approver"], ["techApprover", "tech_approver"],
    ["awardApprover", "award_approver"], ["witness", "witness"], ["auditor", "auditor"],
  ];
  for (const [who, role] of members) {
    await c.query(`insert into event_member (tenant_id, event_id, membership_id, event_role) values ($1, $2, $3, $4)`, [w.tenantId, id, P[who].membershipId, role]);
  }
  const invite = o.invite ?? [0, 1, 2];
  for (const i of invite) {
    await c.query(`insert into invitation (tenant_id, event_id, supplier_id, token_hash) values ($1, $2, $3, $4)`, [w.tenantId, id, w.suppliers[i]!.id, randomUUID()]);
  }
  const objects = { d6: [] as string[], d7: [] as string[] };
  if (o.withBids !== false) {
    for (const [n, s] of w.suppliers.entries()) {
      if (!invite.includes(n)) continue;
      const rev = await c.query(
        `insert into bid_revision (tenant_id, event_id, supplier_id, revision_no, idempotency_key, submitted_at)
         values ($1, $2, $3, 1, $4, now() - interval '2 days') returning id`, [w.tenantId, id, s.id, randomUUID()]);
      const mk = async (cls: string, kind: string, payload: unknown) =>
        (await c.query(`insert into bid_item (tenant_id, bid_revision_id, data_class, kind, payload) values ($1, $2, $3, $4, $5) returning id`,
          [w.tenantId, rev.rows[0].id, cls, kind, JSON.stringify(payload)])).rows[0].id as string;
      const d6 = await mk("D6", "technical_answer", { text: `Datasheet from supplier ${n + 1}` });
      const d7 = await mk("D7", "price_total", { total: 100000 + n * 1000, marker: SECRET });
      await c.query(`insert into derived_item (tenant_id, bid_item_id, data_class, kind, content) values ($1, $2, 'D8', 'extracted_text', $3)`,
        [w.tenantId, d6, `Technical datasheet API 610 hazardous area certificate supplier ${n + 1}`]);
      await c.query(`insert into derived_item (tenant_id, bid_item_id, data_class, kind, content) values ($1, $2, 'D9', 'extracted_text', $3)`,
        [w.tenantId, d7, `Price total AED ${100000 + n * 1000} ${SECRET} supplier ${n + 1}`]);
      for (const [cls, list] of [["D6", objects.d6], ["D7", objects.d7]] as const) {
        const o2 = await c.query(`insert into stored_object (tenant_id, event_id, supplier_id, data_class, path) values ($1, $2, $3, $4, $5) returning id`,
          [w.tenantId, id, s.id, cls, `${w.tenantId}/${id}/${cls}/${s.id}.pdf`]);
        list.push(o2.rows[0].id);
      }
      if (n < 3) {
        await c.query(`insert into clarification (tenant_id, event_id, supplier_id, visibility, body) values ($1, $2, $3, 'private', $4)`,
          [w.tenantId, id, s.id, `Private question from supplier ${n + 1}`]);
      }
    }
    await c.query(`insert into clarification (tenant_id, event_id, visibility, body) values ($1, $2, 'shared', 'Shared answer for everyone')`, [w.tenantId, id]);
  }
  if (reached(state, "technical_evaluation")) {
    for (const s of w.suppliers) {
      await c.query(`insert into gate_result (tenant_id, event_id, supplier_id, passed) values ($1, $2, $3, true)`, [w.tenantId, id, s.id]);
      for (const ev of [P.techA, P.techB]) {
        await c.query(`insert into tech_score (tenant_id, event_id, supplier_id, evaluator_membership_id, criterion, score) values ($1, $2, $3, $4, 'compliance', 80)`,
          [w.tenantId, id, s.id, ev.membershipId]);
      }
    }
  }
  if (reached(state, "technical_approved")) {
    for (const [n, s] of w.suppliers.entries()) {
      await c.query(`insert into tech_result (tenant_id, event_id, supplier_id, total, qualified) values ($1, $2, $3, 80, $4)`, [w.tenantId, id, s.id, n < 2]);
      if (n < 2) await c.query(`insert into qualified_bidder (tenant_id, event_id, supplier_id) values ($1, $2, $3)`, [w.tenantId, id, s.id]);
    }
    await c.query(`insert into opening_record (tenant_id, event_id, envelope, opened_by, witness) values ($1, $2, 1, $3, $4)`, [w.tenantId, id, P.buyer.membershipId, P.witness.membershipId]);
  }
  if (env2) {
    await c.query(`insert into opening_record (tenant_id, event_id, envelope, opened_by, witness, qualified_supplier_ids) values ($1, $2, 2, $3, $4, $5::uuid[])`,
      [w.tenantId, id, P.buyer.membershipId, P.witness.membershipId, [w.suppliers[0].id, w.suppliers[1].id]]);
    await c.query(`insert into calculation_run (tenant_id, event_id, model_version, status, input_hash, inputs, outputs) values ($1, $2, 'equipment_tco@1', 'COMPLETE', 'h', '{}', '{}')`, [w.tenantId, id]);
  }
  return { id, objects };
}

export { STATE_ORDER };
