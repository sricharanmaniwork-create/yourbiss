/**
 * Row shapes for the tables created by supabase/migrations. Kept hand-written
 * (rather than `gen types`) so they stay readable and reviewable; the repository
 * layer in src/lib/repo is the only place that casts query results into them.
 */

import type { PageTree } from '@/lib/blocks/types';
import type { FormFieldDef, FormSettings } from '@/lib/forms/types';

export type AppKey = 'website' | 'forms' | 'bookings' | 'crm' | 'inventory' | 'store' | 'automations' | 'board';
export type OrgRole = 'owner' | 'admin' | 'member';

export interface Org {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  status: 'active' | 'suspended' | 'archived';
  timezone: string;
  currency: string;
  locale: string;
  logo_url: string | null;
  plan_key: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  invited_by: string | null;
  created_at: string;
  profile?: Pick<UserProfile, 'display_name' | 'email' | 'avatar_url' | 'job_title'> | null;
}

export interface OrgInvite {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface OrgApp {
  org_id: string;
  app_key: AppKey;
  status: 'enabled' | 'disabled';
  settings: Record<string, unknown>;
}

export interface UserProfile {
  user_id: string;
  display_name: string;
  email: string;
  job_title: string | null;
  phone: string | null;
  avatar_url: string | null;
  onboarded_at: string | null;
}

export interface ActivityEntry {
  id: number;
  org_id: string;
  actor_id: string | null;
  app_key: AppKey | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  summary: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  actor?: Pick<UserProfile, 'display_name'> | null;
}

// --- website ---------------------------------------------------------------

export interface SiteTheme {
  colors: { primary: string; surface: string; background: string; text: string; muted: string; border: string };
  fonts: { heading: string; body: string };
  radius: string;
  max_width: string;
  section_gap: string;
}

export interface Site {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  theme: SiteTheme;
  settings: Record<string, unknown>;
  favicon_url: string | null;
  custom_domain: string | null;
  domain_status: 'unverified' | 'pending' | 'verified' | 'failed';
  verification_token: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SitePage {
  id: string;
  site_id: string;
  org_id: string;
  title: string;
  path: string;
  is_home: boolean;
  status: 'draft' | 'published' | 'archived';
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  draft_tree: PageTree;
  published_tree: PageTree | null;
  published_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SiteVersion {
  id: string;
  site_id: string;
  number: number;
  note: string | null;
  page_count: number;
  created_at: string;
  created_by: string | null;
}

// --- forms -----------------------------------------------------------------

export interface FormRow {
  id: string;
  org_id: string;
  site_id: string | null;
  title: string;
  description: string | null;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  fields: FormFieldDef[];
  layout: string[];
  settings: FormSettings;
  theme: Record<string, unknown>;
  submission_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormPrivateRow {
  form_id: string;
  org_id: string;
  notify_emails: string[];
  notify_recipient: boolean;
  confirmation_subject: string | null;
  confirmation_html: string | null;
  redirect_url: string | null;
  webhook_url: string | null;
}

export interface FormSubmissionRow {
  id: string;
  form_id: string;
  org_id: string;
  data: Record<string, unknown>;
  submitter_email: string | null;
  state: 'new' | 'read' | 'replied' | 'spam';
  source_url: string | null;
  created_at: string;
}

// --- bookings --------------------------------------------------------------

export interface BookingService {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  slot_step_min: number;
  min_lead_min: number;
  max_horizon_days: number;
  daily_limit: number | null;
  capacity: number;
  price_cents: number;
  currency: string;
  location_kind: 'onsite' | 'online' | 'phone';
  timezone: string;
  color: string;
  intake_form_id: string | null;
  page_config: Record<string, unknown>;
  status: 'active' | 'hidden' | 'archived';
  sort_order: number;
}

export interface BookingStaff {
  id: string;
  org_id: string;
  user_id: string | null;
  name: string;
  slug: string;
  bio: string | null;
  avatar_url: string | null;
  timezone: string;
  status: 'active' | 'hidden' | 'archived';
  sort_order: number;
  service_ids?: string[];
}

export interface BookingAvailability {
  id: string;
  staff_id: string;
  org_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  breaks?: { id: string; starts_at: string; ends_at: string }[];
}

export interface BookingException {
  id: string;
  staff_id: string;
  day: string;
  kind: 'closed' | 'extra';
  starts_at: string | null;
  ends_at: string | null;
  reason: string | null;
}

export interface Booking {
  id: string;
  org_id: string;
  service_id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  notes: string | null;
  internal_notes: string | null;
  state: 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'completed';
  source: 'web' | 'embed' | 'manual' | 'import';
  code: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  service?: Pick<BookingService, 'name' | 'color' | 'duration_min'> | null;
  staff?: Pick<BookingStaff, 'name'> | null;
}

export interface Slot {
  starts_at: string;
  ends_at: string;
  state: string;
}

export interface DayAvailability {
  day: string;
  closed: boolean;
  has_free_slot: boolean;
}

// --- crm ---------------------------------------------------------------------

export type CrmLeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'unqualified';
export type CrmStageKind = 'open' | 'won' | 'lost';
export type CrmActivityKind = 'note' | 'call' | 'meeting' | 'task';

/** A person this workspace has a relationship with. */
export interface CrmPersonFields {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  owner_id: string | null;
  source: string;
}

export interface CrmContact extends CrmPersonFields {
  id: string;
  org_id: string;
  tags: string[];
  address: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  owner?: Pick<UserProfile, 'display_name' | 'email' | 'avatar_url'> | null;
}

export interface CrmLead extends CrmPersonFields {
  id: string;
  org_id: string;
  status: CrmLeadStatus;
  reason: string | null;
  form_submission_id: string | null;
  booking_id: string | null;
  /** Written only by the convert function, which is why they travel together. */
  converted_contact_id: string | null;
  converted_deal_id: string | null;
  converted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  owner?: Pick<UserProfile, 'display_name' | 'email' | 'avatar_url'> | null;
}

/**
 * A stage row plus what sits on it. `deal_count` is counted by the read, never
 * stored: a board with a stale total on every column is worse than one that
 * counts the cards when it draws them.
 */
export interface CrmStage {
  id: string;
  org_id: string;
  name: string;
  kind: CrmStageKind;
  position: number;
  color: string;
  created_at: string;
  updated_at: string;
  deal_count?: number;
  deal_value?: number;
}

/**
 * There is no `state` column on a deal, and this is why: `stage.kind` says whether
 * it closed and `won_at`/`lost_at` say when, both written by the same trigger. A
 * screen that wants "open deals" filters on the stage, not on a second opinion.
 */
export interface CrmDeal {
  id: string;
  org_id: string;
  title: string;
  stage_id: string;
  contact_id: string | null;
  lead_id: string | null;
  owner_id: string | null;
  amount: number;
  currency: string;
  expected_close: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  stage?: Pick<CrmStage, 'name' | 'kind' | 'color' | 'position'> | null;
  contact?: Pick<CrmContact, 'name' | 'company'> | null;
  lead?: Pick<CrmLead, 'name' | 'company'> | null;
  owner?: Pick<UserProfile, 'display_name' | 'avatar_url'> | null;
}

export interface CrmActivity {
  id: string;
  org_id: string;
  kind: CrmActivityKind;
  subject: string | null;
  body: string | null;
  contact_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  owner_id: string | null;
  due_at: string | null;
  done_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  owner?: Pick<UserProfile, 'display_name' | 'avatar_url'> | null;
  author?: Pick<UserProfile, 'display_name'> | null;
}

// --- inventory ---------------------------------------------------------------

export type InvItemKind = 'product' | 'service';
export type InvItemStatus = 'active' | 'archived';
/** Why a pile of boxes moved. `sale` and `customer_return` are written by Store. */
export type InvMovementReason = 'opening' | 'purchase' | 'sale' | 'customer_return' | 'adjustment';
export type InvPurchaseStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';

export interface InvItem {
  id: string;
  org_id: string;
  name: string;
  sku: string | null;
  kind: InvItemKind;
  status: InvItemStatus;
  unit: string;
  description: string | null;
  price: number;
  cost: number;
  track_stock: boolean;
  reorder_point: number | null;
  image_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * What the ledger says about one item. It is never a column — this is the sum of
 * `inv_movements` — so a shelf and its history cannot tell different stories.
 */
export interface InvStockLevel {
  on_hand: number;
  movements: number;
  last_movement_at: string | null;
}

export interface InvMovement {
  id: string;
  org_id: string;
  item_id: string;
  delta: number;
  reason: InvMovementReason;
  unit_cost: number | null;
  reference: string | null;
  purchase_line_id: string | null;
  created_by: string | null;
  created_at: string;
  item?: Pick<InvItem, 'name' | 'unit' | 'sku'> | null;
  author?: Pick<UserProfile, 'display_name' | 'avatar_url' | 'email'> | null;
}

export interface InvSupplier {
  id: string;
  org_id: string;
  name: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  status: InvItemStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvPurchase {
  id: string;
  org_id: string;
  number: string;
  supplier_id: string;
  status: InvPurchaseStatus;
  order_date: string;
  expected_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  supplier?: Pick<InvSupplier, 'name' | 'contact' | 'email' | 'phone'> | null;
  line_count?: number;
  /** Sum of the line totals, counted by the read rather than stored on the row. */
  total?: number;
  received_qty?: number;
  outstanding_qty?: number;
}

export interface InvPurchaseLine {
  id: string;
  purchase_id: string;
  org_id: string;
  item_id: string;
  description: string;
  qty: number;
  unit_cost: number;
  received_qty: number;
  total: number;
  created_at: string;
  updated_at: string;
  item?: Pick<InvItem, 'name' | 'unit' | 'sku' | 'track_stock'> | null;
}

/** The thirteen numbers `youbiss.inv_counts` answers in one round trip. */
export interface InvCounts {
  items: number;
  products: number;
  services: number;
  tracked: number;
  low_stock: number;
  out_of_stock: number;
  stock_value: number;
  suppliers: number;
  purchases_open: number;
  purchases_value: number;
  awaiting_goods: number;
  receipts_30d: number;
  movements_30d: number;
}

// --- email -----------------------------------------------------------------

export interface EmailSettingsRow {
  org_id: string;
  provider: 'resend' | 'smtp';
  from_address: string;
  from_name: string;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: 'none' | 'ssl' | 'starttls';
  smtp_user: string | null;
  verified_at: string | null;
  last_error: string | null;
  daily_quota: number;
  sent_today: number;
  sent_on: string;
}

// --- session context -------------------------------------------------------

export interface WorkspaceContext {
  org: Org;
  role: OrgRole;
  userId: string;
  apps: Record<AppKey, boolean>;
}

/**
 * Uniform return shape for every server action, so one client hook can render
 * success, a top-level error, and per-field validation for the whole product.
 */
export interface ActionState {
  ok: boolean;
  error?: string;
  fields?: Record<string, string>;
}

/** A block the builder could not validate, addressed by its id in the canvas. */
export interface BlockIssue {
  blockId: string;
  message: string;
}

/**
 * Autosave answers differently from an ordinary form: a draft with a half-filled
 * block still saves — the editor needs to keep the user's work — and the issue
 * comes back as a warning. Publishing is where the same tree is refused.
 */
export interface DraftSaveResult {
  ok: boolean;
  error?: string;
  issues?: BlockIssue[];
  savedAt?: string;
}
