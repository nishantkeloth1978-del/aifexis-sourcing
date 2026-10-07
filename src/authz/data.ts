import type { PoolClient } from "pg";
import { audit, resolvePermitted } from "./service";
import { DEFAULT_RULES, type RuleSet } from "./rules";
import type { Actor, DataClass, Permitted, Scope } from "./types";

/**
 * Data access layer. Every function resolves the actor's permitted classes first and builds the
 * class and scope filter INTO the query, so unpermitted rows are never loaded, searched, ranked or exported.
 * There is deliberately no function here that reads bid tables without a permission set.
 */

const LATEST = `br.revision_no = (select max(x.revision_no) from bid_revision x
   where x.tenant_id = br.tenant_id and x.event_id = br.event_id and x.supplier_id = br.supplier_id)`;

/** SQL predicate for rows of the given bid classes, built from the permission set. Null when nothing is permitted. */
function bidPredicate(
  permitted: Permitted, classes: DataClass[], classCol: string, params: unknown[],
): string | null {
  const parts: string[] = [];
  for (const cls of classes) {
    const scope: Scope | undefined = permitted[cls];
    if (!scope) continue;
    params.push(cls);
    const c = `${classCol} = $${params.length}`;
    if (scope.kind === "all") parts.push(`(${c})`);
    else if (scope.kind === "qualified") {
      parts.push(`(${c} and br.supplier_id in (select q.supplier_id from qualified_bidder q
        where q.tenant_id = br.tenant_id and q.event_id = br.event_id and q.superseded_at is null))`);
    } else if (scope.kind === "ownSupplier") {
      params.push(scope.supplierId);
      parts.push(`(${c} and br.supplier_id = $${params.length})`);
    }
  }
  return parts.length ? `(${parts.join(" or ")})` : null;
}

export interface BidItemRow { id: string; supplierId: string; revisionNo: number; dataClass: DataClass; kind: string; payload: unknown }

export async function readBidItems(
  client: PoolClient, actor: Actor, eventId: string, rules: RuleSet = DEFAULT_RULES,
): Promise<BidItemRow[]> {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok) return [];
  const params: unknown[] = [eventId];
  const pred = bidPredicate(r.permitted, ["D6", "D7"], "bi.data_class", params);
  if (!pred) return [];
  const { rows } = await client.query(
    `select bi.id, br.supplier_id, br.revision_no, bi.data_class, bi.kind, bi.payload
       from bid_item bi join bid_revision br on br.tenant_id = bi.tenant_id and br.id = bi.bid_revision_id
      where br.event_id = $1 and ${LATEST} and ${pred}
      order by br.supplier_id, bi.kind`, params);
  return rows.map((x) => ({ id: x.id, supplierId: x.supplier_id, revisionNo: x.revision_no, dataClass: x.data_class, kind: x.kind, payload: x.payload }));
}

export interface DerivedRow { id: string; supplierId: string; dataClass: DataClass; kind: string; content: string }

async function queryDerived(
  client: PoolClient, permitted: Permitted, eventId: string, like: string | null, limit: number,
): Promise<DerivedRow[]> {
  const params: unknown[] = [eventId];
  const pred = bidPredicate(permitted, ["D8", "D9"], "di.data_class", params);
  if (!pred) return []; // nothing permitted: no query, no counts, no hints
  let textFilter = "";
  if (like) { params.push(`%${like}%`); textFilter = ` and di.content ilike $${params.length}`; }
  params.push(limit);
  const { rows } = await client.query(
    `select di.id, br.supplier_id, di.data_class, di.kind, di.content
       from derived_item di
       join bid_item bi on bi.tenant_id = di.tenant_id and bi.id = di.bid_item_id
       join bid_revision br on br.tenant_id = bi.tenant_id and br.id = bi.bid_revision_id
      where br.event_id = $1 and ${LATEST} and ${pred}${textFilter}
      order by di.id limit $${params.length}`, params);
  return rows.map((x) => ({ id: x.id, supplierId: x.supplier_id, dataClass: x.data_class, kind: x.kind, content: x.content }));
}

/** Search over extracted text, previews and chunks. The class filter is part of the query. */
export async function searchDerived(
  client: PoolClient, actor: Actor, eventId: string, query: string, rules: RuleSet = DEFAULT_RULES,
): Promise<DerivedRow[]> {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok) return [];
  return queryDerived(client, r.permitted, eventId, query, 50);
}

/** Context for an AI model: permissions are applied before retrieval, never after. */
export async function retrieveContext(
  client: PoolClient, actor: Actor, eventId: string, query: string, k = 8, rules: RuleSet = DEFAULT_RULES,
): Promise<DerivedRow[]> {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok) return [];
  const words = query.split(/\s+/).filter((w) => w.length > 2);
  const seen = new Map<string, DerivedRow>();
  for (const w of words.length ? words : [""]) {
    for (const row of await queryDerived(client, r.permitted, eventId, w || null, k)) seen.set(row.id, row);
  }
  return [...seen.values()].slice(0, k);
}

export async function readClarifications(client: PoolClient, actor: Actor, eventId: string, rules: RuleSet = DEFAULT_RULES) {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok) return [];
  const scope = r.permitted.D5;
  if (!scope) return [];
  if (scope.kind === "sharedPlusOwn") {
    const { rows } = await client.query(
      `select id, supplier_id, visibility, body, kind, parent_id, question_text, created_at from clarification
        where event_id = $1 and (visibility = 'shared' or supplier_id = $2) order by created_at`, [eventId, scope.supplierId]);
    return rows;
  }
  const { rows } = await client.query(`select id, supplier_id, visibility, body, kind, parent_id, question_text, created_at from clarification where event_id = $1 order by created_at`, [eventId]);
  return rows;
}

export async function readTechScores(client: PoolClient, actor: Actor, eventId: string, rules: RuleSet = DEFAULT_RULES) {
  const r = await resolvePermitted(client, actor, eventId, rules);
  const scope = r.ok ? r.permitted.D11 : undefined;
  if (!scope) return [];
  const params: unknown[] = [eventId];
  let own = "";
  if (scope.kind === "ownEvaluator") { params.push(scope.membershipId); own = " and evaluator_membership_id = $2"; }
  const { rows } = await client.query(
    `select supplier_id, evaluator_membership_id, criterion, score from tech_score where event_id = $1${own}`, params);
  return rows;
}

export async function readTechResults(client: PoolClient, actor: Actor, eventId: string, rules: RuleSet = DEFAULT_RULES) {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok || !r.permitted.D12) return [];
  const { rows } = await client.query(`select supplier_id, total, qualified from tech_result where event_id = $1`, [eventId]);
  return rows;
}

export async function readCalculationRuns(client: PoolClient, actor: Actor, eventId: string, rules: RuleSet = DEFAULT_RULES) {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok || !r.permitted.D13) return [];
  const { rows } = await client.query(`select id, status, model_version, outputs from calculation_run where event_id = $1 order by created_at`, [eventId]);
  return rows;
}

/** Export contains only what the actor may read at export time; the export itself is audited with the classes included. */
export async function exportEvent(client: PoolClient, actor: Actor, eventId: string, rules: RuleSet = DEFAULT_RULES) {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok) return null;
  const bidItems = await readBidItems(client, actor, eventId, rules);
  const derived = await queryDerived(client, r.permitted, eventId, null, 1000);
  const techResults = await readTechResults(client, actor, eventId, rules);
  const classes = Object.keys(r.permitted).sort();
  await audit(client, actor, eventId, "export", { classes });
  return { event: { id: r.event.id, title: r.event.title, state: r.event.state }, classes, bidItems, derived, techResults };
}

/** Plain-text digest for notifications. Commercial figures appear only for recipients who may read D7. */
export async function renderDigest(client: PoolClient, actor: Actor, eventId: string, rules: RuleSet = DEFAULT_RULES): Promise<string> {
  const r = await resolvePermitted(client, actor, eventId, rules);
  if (!r.ok) return "";
  const lines = [`Event ${r.event.title}: ${r.event.state}`];
  if (r.permitted.D7) {
    const items = (await readBidItems(client, actor, eventId, rules)).filter((i) => i.dataClass === "D7" && i.kind === "price_total");
    for (const i of items) lines.push(`Supplier ${i.supplierId.slice(0, 8)}: total ${(i.payload as { total: number }).total}`);
  }
  return lines.join("\n");
}
