/** Client-safe: the company's Ariba purchase-order mapping. */
export interface AribaMapping { buyerNetworkId: string; buyerName: string; shipToName: string; testMode: boolean; uomMap: Record<string, string> }
