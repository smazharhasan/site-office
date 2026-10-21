-- AI provider chosen by the owner (Claude or Google Gemini). The key is stored here and read only by
-- the Edge Functions (service role); no policy lets any app user read or write this table.
create table if not exists ai_settings (
  project_id uuid primary key references projects(id) on delete cascade,
  provider text not null default 'claude' check (provider in ('claude', 'gemini', 'off')),
  model text,
  model_complex text,
  model_fast text,
  api_key text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table ai_settings enable row level security;
revoke all on ai_settings from anon, authenticated;

-- invoices and work orders follow the purchase-order access rules
create or replace function app_rec_key(c text) returns text language sql immutable as $$
  select case
    when c in ('selections') then 'changes'
    when c in ('contractText') then 'contracts'
    when c in ('tank') then 'water'
    when c in ('peopleDocs') then 'people'
    when c in ('config', 'reports') then 'settings'
    when c in ('invoices', 'workorders') then 'pos'
    when c = 'changesMoney' then 'changes' when c = 'selectionsMoney' then 'changes' when c = 'posMoney' then 'pos'
    when c = 'materialsMoney' then 'materials' when c = 'grnsMoney' then 'grns' when c = 'waterMoney' then 'water'
    when c = 'peopleMoney' then 'people' when c = 'risksMoney' then 'risks'
    when c in ('milestones','stages','subtasks','payments','budget','changes','contracts','pettycash','suppliers','materials','rfqs','quotes','pos','dns','grns','returns','issues','counts','water','inspections','checklists','snags','drawings','risks','logs','attendance','camera','people','members','audits') then c
    else null end $$;
create or replace function app_money_key(c text) returns text language sql immutable as $$
  select case c
    when 'budget' then 'budget' when 'contracts' then 'contractValue' when 'contractText' then 'contractValue'
    when 'payments' then 'payments' when 'changesMoney' then 'changeCost' when 'selectionsMoney' then 'selections'
    when 'quotes' then 'quotes' when 'posMoney' then 'poPrices' when 'materialsMoney' then 'matRates'
    when 'grnsMoney' then 'grnBill' when 'pettycash' then 'pettycash' when 'waterMoney' then 'water'
    when 'peopleMoney' then 'wages' when 'risksMoney' then 'riskCost'
    when 'invoices' then 'poPrices' when 'workorders' then 'poPrices' else null end $$;
