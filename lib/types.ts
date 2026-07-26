/**
 * Hand-written DB types. Small enough that generated types would add a
 * codegen step for no benefit.
 *
 * Dates are always plain 'YYYY-MM-DD' strings and are never passed through
 * `new Date()` for display — purchase_date is a calendar date, and a timezone
 * round-trip would shift purchases across midnight (PRD §8).
 */

export type IsoDate = string; // YYYY-MM-DD

/**
 * Rows handed to Astryx's Table must be indexable, and supabase-js needs the
 * full schema shape (Tables/Views/Functions/Enums/CompositeTypes) to resolve
 * its generics — a partial shape silently collapses every query type to
 * `never`.
 */
type Indexable = Record<string, unknown>;

export interface Vendor extends Indexable {
  id: string;
  name: string;
  display_name: string;
  created_at: string;
}

export interface VendorStats extends Vendor {
  product_count: number;
  entry_count: number;
  earliest_purchase: IsoDate | null;
  latest_purchase: IsoDate | null;
}

export interface Product extends Indexable {
  id: string;
  vendor_id: string;
  description: string;
  description_norm: string;
  product_code: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceEntry extends Indexable {
  id: string;
  product_id: string;
  purchase_date: IsoDate;
  unit_price: number;
  quantity: number;
  line_amount: number | null;
  voucher_no: string | null;
  source: 'ledger_import' | 'manual';
  source_batch: string | null;
  source_line_no: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One point of a product's price history. */
export interface SparkPoint extends Indexable {
  d: IsoDate;
  p: number;
}

/** A row of product_summary(from, to) — the main table's shape. */
export interface ProductSummary extends Indexable {
  product_id: string;
  vendor_id: string;
  vendor_name: string;
  description: string;
  product_code: string | null;
  entry_count: number;
  first_price: number | null;
  current_price: number | null;
  min_price: number | null;
  max_price: number | null;
  first_purchase_date: IsoDate | null;
  last_purchase_date: IsoDate | null;
  change_pct: number | null;
  volatility_pct: number | null;
  sparkline: SparkPoint[];
  created_at: string;
  updated_at: string;
}

/** A row of product_entries(product_id, from, to) — the detail table's shape. */
export interface ProductEntryRow extends Indexable {
  id: string;
  purchase_date: IsoDate;
  unit_price: number;
  quantity: number;
  line_amount: number | null;
  voucher_no: string | null;
  source: 'ledger_import' | 'manual';
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      vendors: {
        Row: Vendor;
        Insert: Partial<Vendor>;
        Update: Partial<Vendor>;
        Relationships: [];
      };
      products: {
        Row: Product;
        Insert: Partial<Product> & {vendor_id: string; description: string};
        Update: Partial<Product>;
        Relationships: [];
      };
      price_entries: {
        Row: PriceEntry;
        Insert: Partial<PriceEntry> & {
          product_id: string;
          purchase_date: IsoDate;
          unit_price: number;
          quantity: number;
        };
        Update: Partial<PriceEntry>;
        Relationships: [];
      };
    };
    Views: {
      vendor_stats: {Row: VendorStats; Relationships: []};
      app_users: {Row: {id: string; email: string | null}; Relationships: []};
    };
    Functions: {
      product_summary: {
        Args: {p_from: IsoDate | null; p_to: IsoDate | null};
        Returns: ProductSummary[];
      };
      product_entries: {
        Args: {
          p_product_id: string;
          p_from: IsoDate | null;
          p_to: IsoDate | null;
        };
        Returns: ProductEntryRow[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
