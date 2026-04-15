-- ==============================================================
-- BarberSaaS - Atualizacao de Banco (estado atual do projeto)
-- Data: 2026-04-15
-- Banco alvo: Supabase Postgres
-- Objetivo: criar/ajustar schema usado pelo frontend atual
-- ============================================================== 

begin;

-- Extensoes necessarias para UUID
create extension if not exists pgcrypto;

-- ==============================================================
-- 1) TABELA: barbearias
-- ==============================================================
create table if not exists public.barbearias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  endereco text,
  whatsapp text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.barbearias add column if not exists nome text;
alter table public.barbearias add column if not exists slug text;
alter table public.barbearias add column if not exists endereco text;
alter table public.barbearias add column if not exists whatsapp text;
alter table public.barbearias add column if not exists logo_url text;
alter table public.barbearias add column if not exists created_at timestamptz not null default now();
alter table public.barbearias add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_barbearias_slug on public.barbearias (slug);

-- ==============================================================
-- 2) TABELA: barbeiros
-- ==============================================================
create table if not exists public.barbeiros (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid,
  barbearia_slug text,
  user_id uuid,
  nome text not null,
  email text,
  usuario text,
  senha text,
  foto_url text,
  servicos text,
  servicos_json jsonb not null default '[]'::jsonb,
  preco_base numeric(10,2),
  status text not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_barbeiros_status check (status in ('ativo', 'inativo', 'pendente')),
  constraint fk_barbeiros_barbearia
    foreign key (barbearia_id) references public.barbearias(id)
    on update cascade on delete set null
);

alter table public.barbeiros add column if not exists barbearia_id uuid;
alter table public.barbeiros add column if not exists barbearia_slug text;
alter table public.barbeiros add column if not exists user_id uuid;
alter table public.barbeiros add column if not exists nome text;
alter table public.barbeiros add column if not exists email text;
alter table public.barbeiros add column if not exists usuario text;
alter table public.barbeiros add column if not exists senha text;
alter table public.barbeiros add column if not exists foto_url text;
alter table public.barbeiros add column if not exists servicos text;
alter table public.barbeiros add column if not exists servicos_json jsonb not null default '[]'::jsonb;
alter table public.barbeiros add column if not exists preco_base numeric(10,2);
alter table public.barbeiros add column if not exists status text not null default 'ativo';
alter table public.barbeiros add column if not exists created_at timestamptz not null default now();
alter table public.barbeiros add column if not exists updated_at timestamptz not null default now();

-- Normaliza nulos legados
update public.barbeiros
set servicos_json = '[]'::jsonb
where servicos_json is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_barbeiros_status'
      and conrelid = 'public.barbeiros'::regclass
  ) then
    alter table public.barbeiros
      add constraint ck_barbeiros_status
      check (status in ('ativo', 'inativo', 'pendente'));
  end if;
end $$;

create index if not exists ix_barbeiros_barbearia_id on public.barbeiros (barbearia_id);
create index if not exists ix_barbeiros_barbearia_slug on public.barbeiros (barbearia_slug);
create index if not exists ix_barbeiros_status on public.barbeiros (status);
create unique index if not exists ux_barbeiros_usuario on public.barbeiros (usuario) where usuario is not null;

-- ==============================================================
-- 3) TABELA: servicos (legado/apoio do fluxo do cliente)
-- ==============================================================
create table if not exists public.servicos (
  id uuid primary key default gen_random_uuid(),
  barbearia_slug text not null,
  nome text not null,
  preco numeric(10,2) not null default 0,
  duracao int not null default 45,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.servicos add column if not exists barbearia_slug text;
alter table public.servicos add column if not exists nome text;
alter table public.servicos add column if not exists preco numeric(10,2) not null default 0;
alter table public.servicos add column if not exists duracao int not null default 45;
alter table public.servicos add column if not exists ativo boolean not null default true;
alter table public.servicos add column if not exists created_at timestamptz not null default now();
alter table public.servicos add column if not exists updated_at timestamptz not null default now();

create index if not exists ix_servicos_slug_ativo on public.servicos (barbearia_slug, ativo);

-- ==============================================================
-- 4) TABELA: agendamentos
-- Observacao importante:
--   - Bloqueios manuais sao gravados aqui com:
--     status = 'bloqueado'
--     cliente_nome = 'BLOQUEIO MANUAL'
-- ==============================================================
create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  barbearia_slug text not null,
  barbeiro_id uuid,
  data date not null,
  horario text not null,
  status text not null default 'pendente',
  cliente_nome text,
  cliente_telefone text,
  servico_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_agendamentos_status
    check (status in ('pendente', 'confirmado', 'cancelado', 'bloqueado')),
  constraint fk_agendamentos_barbeiro
    foreign key (barbeiro_id) references public.barbeiros(id)
    on update cascade on delete set null
);

alter table public.agendamentos add column if not exists barbearia_slug text;
alter table public.agendamentos add column if not exists barbeiro_id uuid;
alter table public.agendamentos add column if not exists data date;
alter table public.agendamentos add column if not exists horario text;
alter table public.agendamentos add column if not exists status text not null default 'pendente';
alter table public.agendamentos add column if not exists cliente_nome text;
alter table public.agendamentos add column if not exists cliente_telefone text;
alter table public.agendamentos add column if not exists servico_nome text;
alter table public.agendamentos add column if not exists created_at timestamptz not null default now();
alter table public.agendamentos add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_agendamentos_status'
      and conrelid = 'public.agendamentos'::regclass
  ) then
    alter table public.agendamentos
      add constraint ck_agendamentos_status
      check (status in ('pendente', 'confirmado', 'cancelado', 'bloqueado'));
  end if;
end $$;

create index if not exists ix_agendamentos_slug_data on public.agendamentos (barbearia_slug, data);
create index if not exists ix_agendamentos_barbeiro_data on public.agendamentos (barbeiro_id, data);
create index if not exists ix_agendamentos_status on public.agendamentos (status);
create unique index if not exists ux_agendamentos_slot_ativo
  on public.agendamentos (barbearia_slug, barbeiro_id, data, horario)
  where status in ('pendente', 'confirmado', 'bloqueado');

-- ==============================================================
-- 5) TABELA: portfolio
-- ==============================================================
create table if not exists public.portfolio (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null,
  image_url text not null,
  descricao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_portfolio_barbearia
    foreign key (barbearia_id) references public.barbearias(id)
    on update cascade on delete cascade
);

alter table public.portfolio add column if not exists barbearia_id uuid;
alter table public.portfolio add column if not exists image_url text;
alter table public.portfolio add column if not exists descricao text;
alter table public.portfolio add column if not exists created_at timestamptz not null default now();
alter table public.portfolio add column if not exists updated_at timestamptz not null default now();

create index if not exists ix_portfolio_barbearia_id on public.portfolio (barbearia_id);

-- ==============================================================
-- 6) Trigger padrao para updated_at
-- ==============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_barbearias_updated_at on public.barbearias;
create trigger trg_barbearias_updated_at
before update on public.barbearias
for each row execute function public.set_updated_at();

drop trigger if exists trg_barbeiros_updated_at on public.barbeiros;
create trigger trg_barbeiros_updated_at
before update on public.barbeiros
for each row execute function public.set_updated_at();

drop trigger if exists trg_servicos_updated_at on public.servicos;
create trigger trg_servicos_updated_at
before update on public.servicos
for each row execute function public.set_updated_at();

drop trigger if exists trg_agendamentos_updated_at on public.agendamentos;
create trigger trg_agendamentos_updated_at
before update on public.agendamentos
for each row execute function public.set_updated_at();

drop trigger if exists trg_portfolio_updated_at on public.portfolio;
create trigger trg_portfolio_updated_at
before update on public.portfolio
for each row execute function public.set_updated_at();

-- ==============================================================
-- 7) RLS e Policies (modelo publico controlado por filtros no app)
-- ==============================================================
alter table public.barbearias enable row level security;
alter table public.barbeiros enable row level security;
alter table public.servicos enable row level security;
alter table public.agendamentos enable row level security;
alter table public.portfolio enable row level security;

-- Remove policies antigas para evitar conflitos de nome

drop policy if exists barbearias_select_public on public.barbearias;
drop policy if exists barbearias_insert_public on public.barbearias;
drop policy if exists barbearias_update_public on public.barbearias;
drop policy if exists barbearias_delete_public on public.barbearias;

drop policy if exists barbeiros_select_public on public.barbeiros;
drop policy if exists barbeiros_insert_public on public.barbeiros;
drop policy if exists barbeiros_update_public on public.barbeiros;
drop policy if exists barbeiros_delete_public on public.barbeiros;

drop policy if exists servicos_select_public on public.servicos;
drop policy if exists servicos_insert_public on public.servicos;
drop policy if exists servicos_update_public on public.servicos;
drop policy if exists servicos_delete_public on public.servicos;

drop policy if exists agendamentos_select_public on public.agendamentos;
drop policy if exists agendamentos_insert_public on public.agendamentos;
drop policy if exists agendamentos_update_public on public.agendamentos;
drop policy if exists agendamentos_delete_public on public.agendamentos;

drop policy if exists portfolio_select_public on public.portfolio;
drop policy if exists portfolio_insert_public on public.portfolio;
drop policy if exists portfolio_update_public on public.portfolio;
drop policy if exists portfolio_delete_public on public.portfolio;

-- Policies permissivas para compatibilidade com frontend atual (anon)
create policy barbearias_select_public on public.barbearias for select using (true);
create policy barbearias_insert_public on public.barbearias for insert with check (true);
create policy barbearias_update_public on public.barbearias for update using (true) with check (true);
create policy barbearias_delete_public on public.barbearias for delete using (true);

create policy barbeiros_select_public on public.barbeiros for select using (true);
create policy barbeiros_insert_public on public.barbeiros for insert with check (true);
create policy barbeiros_update_public on public.barbeiros for update using (true) with check (true);
create policy barbeiros_delete_public on public.barbeiros for delete using (true);

create policy servicos_select_public on public.servicos for select using (true);
create policy servicos_insert_public on public.servicos for insert with check (true);
create policy servicos_update_public on public.servicos for update using (true) with check (true);
create policy servicos_delete_public on public.servicos for delete using (true);

create policy agendamentos_select_public on public.agendamentos for select using (true);
create policy agendamentos_insert_public on public.agendamentos for insert with check (true);
create policy agendamentos_update_public on public.agendamentos for update using (true) with check (true);
create policy agendamentos_delete_public on public.agendamentos for delete using (true);

create policy portfolio_select_public on public.portfolio for select using (true);
create policy portfolio_insert_public on public.portfolio for insert with check (true);
create policy portfolio_update_public on public.portfolio for update using (true) with check (true);
create policy portfolio_delete_public on public.portfolio for delete using (true);

-- ==============================================================
-- 8) Storage bucket para fotos de perfil do colaborador
-- ==============================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    if not exists (select 1 from storage.buckets where id = 'barbeiros-perfis') then
      insert into storage.buckets (id, name, public)
      values ('barbeiros-perfis', 'barbeiros-perfis', true);
    else
      update storage.buckets
         set public = true
       where id = 'barbeiros-perfis';
    end if;
  end if;
end $$;

commit;
