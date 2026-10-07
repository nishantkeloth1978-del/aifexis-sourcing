export type BlockType = "UNIT_PRICE" | "LUMP_SUM" | "RATE_X_EST_QTY" | "CAPPED_AMOUNT";

export interface BlockDef {
  id: string;
  type: BlockType;
  /** INFO blocks are shown but never enter totals or scores. */
  evaluation: "SCORED" | "INFO";
  /** Carried separately to the award and handover. */
  commitment: "COMMITTED" | "ESTIMATED";
  required?: boolean; // default true
  allowZero?: boolean; // default false
}

export interface AdjustmentDef {
  id: string;
  /** Block ids whose rounded AED values form the base. */
  base: string[];
  /** Decimal fraction, up to 6 places; negative for a discount. */
  pct: string;
  /** Adjustment is zero when the bid's origin equals this value. */
  exemptIfOrigin?: string;
}

export interface ModelDef {
  model: string;
  version: number;
  evaluationCurrency: string;
  blocks: BlockDef[];
  adjustments: AdjustmentDef[];
  scoring: {
    method: "lowest_over_bid";
    weights: { technical: string; commercial: string }; // decimal fractions, sum to 1
  };
  /** Ranks closer than this many points raise the close-result flag. */
  closeResultMargin: string;
  /** Alternative weightings for the stored sensitivity table. */
  sensitivityWeights: [string, string][];
  technicalThreshold?: string;
}

export interface Line {
  id?: string;
  /** UNIT_PRICE */
  unitPrice?: string;
  qty?: string;
  /** LUMP_SUM */
  price?: string;
  /** RATE_X_EST_QTY */
  rate?: string;
  evalQty?: string;
  /** Unit check */
  unit?: string;
  requiredUnit?: string;
  unitMapped?: boolean;
}

export type BlockInput = { lines: Line[] } | { cap: string; evaluatedPct?: string };

export interface BidInput {
  bidderId: string;
  currency: string;
  origin?: string;
  /** ISO time of the final submission, used as the last tie-break. */
  submittedAt?: string;
  blocks: Record<string, BlockInput>;
}

/** Currency code to rate string (units of evaluation currency per 1 unit of foreign currency), up to 6 places. */
export type Rates = Record<string, string>;

export interface Reason {
  bidderId?: string;
  code: string;
}

export interface BidderResult {
  bidderId: string;
  /** Rounded values in evaluation currency, scale 2, as decimal strings. */
  blocks: Record<string, string>;
  adjustments: Record<string, string>;
  total: string;
  committed: string;
  estimated: string;
  info: string;
}

export interface ScoreRow {
  bidderId: string;
  technical: string;
  commercial: string;
  combined: string;
  rank: number;
}

export interface CalcRun {
  status: "COMPLETE" | "INCOMPLETE";
  reasons: Reason[];
  modelVersion: string;
  evaluationCurrency: string;
  inputHash: string;
  bidders: BidderResult[];
  scores?: ScoreRow[];
  /** Set when equal combined and technical scores and equal submission times remain. */
  manualDecisionRequired?: boolean;
  closeResult?: { marginPoints: string; flagged: boolean; marginAboveThreshold?: Record<string, string> };
  sensitivity?: { technical: string; commercial: string; ranking: string[]; combined: Record<string, string> }[];
}
