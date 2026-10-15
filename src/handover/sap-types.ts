/** Client-safe: the company's SAP purchase-order mapping. */
export interface SapMapping { companyCode: string; purchOrg: string; purchGroup: string; plant: string; docType: string; uomMap: Record<string, string> }
export const EMPTY_SAP_MAPPING: SapMapping = { companyCode: "", purchOrg: "", purchGroup: "", plant: "", docType: "NB", uomMap: {} };
