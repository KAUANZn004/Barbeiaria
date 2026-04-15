/* ====================================================
   API.JS — BarberSaaS
   Arquivo: assets/js/api.js

   RESPONSABILIDADE:
     Única camada de comunicação com o banco de dados
     (Supabase). Nenhuma outra função neste arquivo
     manipula o DOM ou contém lógica de UI.

   DEPENDÊNCIAS:
     Deve ser carregado APÓS o SDK do Supabase no HTML.
     Expõe os objetos globais: `SupabaseConfig` e `Api`.

   TABELAS ACESSADAS:
     ✦ barbearias  → dados do salão (nome, endereço, foto)
     ✦ servicos    → serviços ativos com preço e duração
     ✦ agendamentos → reservas dos clientes (SELECT e INSERT)
     ✦ portfolio   → imagens de trabalhos do barbeiro
     ✦ reviews     → avaliações dos clientes

   ESTRATÉGIA DE FALLBACK (modo demo):
     Quando o Supabase não está configurado (credenciais
     padrão) ou offline, cada função retorna dados fictícios
     do objeto `DemoData`. Isso permite demonstrar o sistema
     sem banco de dados real.
   ==================================================== */

'use strict';


/* ──────────────────────────────────────────────────────
   CREDENCIAIS DO SUPABASE
   ► Como configurar:
     1. Acesse https://supabase.com → seu projeto
     2. Vá em Settings → API
     3. Copie "Project URL" e "anon / public" Key
     4. Substitua os valores abaixo
   ──────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://fhqrrxrkthpnesouwiys.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FtoKh4ddJrPQkDB7rQDzMQ_d3QcOUTw';


/* ──────────────────────────────────────────────────────
   INICIALIZAÇÃO DO CLIENTE SUPABASE
   O try/catch garante que uma chave inválida não quebre
   toda a página — o sistema simplesmente entra em modo demo.
   `supabaseClient` fica disponível globalmente para main.js.
   ──────────────────────────────────────────────────── */
let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.warn('[api.js] Supabase não inicializado. Modo demo ativo.', err);
}


/* ──────────────────────────────────────────────────────
   DADOS DE DEMONSTRAÇÃO (DemoData)
   Utilizados como fallback quando o Supabase está
   indisponível. Espelham a estrutura real das tabelas.
   ──────────────────────────────────────────────────── */
const DemoData = {

  /** Espelha a tabela `barbearias` */
  barbearia: {
    nome:             'Barbearia Premium',
    endereco:         'Rua das Flores, 123 — Centro',
    whatsapp:         '5511999999999',
    hero_image:       'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&auto=format&fit=crop',
    avaliacao_media:  4.9,
    total_avaliacoes: 128,
  },

  /** Espelha a tabela `servicos` */
  servicos: [
    { id: '1', nome: 'Corte Degradê',  duracao: 40, preco: 45.00 },
    { id: '2', nome: 'Barba Completa', duracao: 30, preco: 35.00 },
    { id: '3', nome: 'Corte + Barba',  duracao: 60, preco: 70.00 },
    { id: '4', nome: 'Hidratação',     duracao: 20, preco: 25.00 },
    { id: '5', nome: 'Sobrancelha',    duracao: 15, preco: 15.00 },
    { id: '6', nome: 'Platinado',      duracao: 90, preco: 120.00 },
  ],

  /** Espelha a tabela `portfolio` */
  portfolio: [
    { id: '1', image_url: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=400&auto=format&fit=crop', descricao: 'Degradê clássico' },
    { id: '2', image_url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=400&auto=format&fit=crop', descricao: 'Barba modelada' },
    { id: '3', image_url: 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&auto=format&fit=crop', descricao: 'Corte social' },
    { id: '4', image_url: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=400&auto=format&fit=crop', descricao: 'Barba completa' },
    { id: '5', image_url: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=400&auto=format&fit=crop', descricao: 'Undercut moderno' },
    { id: '6', image_url: 'https://images.unsplash.com/photo-1540553016722-983e48a2cd10?w=400&auto=format&fit=crop', descricao: 'Platinado' },
  ],

  /** Espelha a tabela `reviews` */
  reviews: [
    { id: '1', cliente_nome: 'Carlos Silva',   nota: 5, comentario: 'Melhor barbearia da cidade! Atendimento impecável.', created_at: '2026-04-10T14:30:00' },
    { id: '2', cliente_nome: 'Rafael Santos',  nota: 5, comentario: 'Corte ficou perfeito! O profissional é muito habilidoso.', created_at: '2026-03-28T10:15:00' },
    { id: '3', cliente_nome: 'Lucas Oliveira', nota: 4, comentario: 'Excelente trabalho, ambiente muito agradável.', created_at: '2026-03-15T16:00:00' },
    { id: '4', cliente_nome: 'Pedro Alves',    nota: 5, comentario: 'Primeira vez aqui e já virei cliente fiel.', created_at: '2026-03-05T11:30:00' },
  ],
};


/* ──────────────────────────────────────────────────────
   OBJETO Api
   Cada método é auto-suficiente: verifica se o Supabase
   está configurado, executa a query e retorna um valor
   padronizado. Em caso de erro, registra no console e
   retorna o dado de demonstração correspondente.
   ──────────────────────────────────────────────────── */
const Api = {

  /**
   * Verifica se o cliente Supabase está operacional.
   * Retorna false quando as credenciais são padrão ou
   * quando o createClient() falhou.
   *
   * @returns {boolean}
   */
  isConfigured() {
    return (
      supabaseClient !== null &&
      !SUPABASE_URL.includes('YOUR_PROJECT_ID')
    );
  },


  /* ──────────────────────────────────────────────────
     fetchBarbearia(slug)
     O QUE FAZ: Busca os dados completos de uma barbearia
                pelo seu slug único.
     PARÂMETROS:
       slug {string} — ex: 'vzp' (vem do parâmetro ?b= da URL)
     IMPACTO NO BANCO:
       SELECT * FROM barbearias WHERE slug = slug LIMIT 1
     RETORNA: objeto barbearia ou DemoData.barbearia
  ────────────────────────────────────────────────── */
  async fetchBarbearia(slug) {
    if (!this.isConfigured()) return DemoData.barbearia;
    try {
      const { data, error } = await supabaseClient
        .from('barbearias')
        .select('*')
        .eq('slug', slug)
        .single();
      if (error) throw error;
      return data || DemoData.barbearia;
    } catch (err) {
      console.warn('[api.js] fetchBarbearia → fallback demo:', err.message);
      return DemoData.barbearia;
    }
  },


  /* ──────────────────────────────────────────────────
     fetchServicos(slug)
     O QUE FAZ: Busca todos os serviços ativos de uma
                barbearia, ordenados do mais barato ao
                mais caro.
     PARÂMETROS:
       slug {string} — slug da barbearia
     IMPACTO NO BANCO:
       SELECT * FROM servicos
         WHERE barbearia_slug = slug AND ativo = true
         ORDER BY preco ASC
     RETORNA: array de serviços ou DemoData.servicos
  ────────────────────────────────────────────────── */
  async fetchServicos(slug) {
    if (!this.isConfigured()) return DemoData.servicos;
    try {
      const { data, error } = await supabaseClient
        .from('servicos')
        .select('*')
        .eq('barbearia_slug', slug)
        .eq('ativo', true)
        .order('preco', { ascending: true });
      if (error) throw error;
      return data?.length ? data : DemoData.servicos;
    } catch (err) {
      console.warn('[api.js] fetchServicos → fallback demo:', err.message);
      return DemoData.servicos;
    }
  },


  /* ──────────────────────────────────────────────────
     fetchAgendamentos(slug, dateStr, barbeiroId?)
     O QUE FAZ: Retorna os horários ocupados (não cancelados)
                para uma data específica. Usado para bloquear
                visualmente os slots de hora na grade.

     PARÂMETROS:
       slug      {string}      — slug da barbearia
       dateStr   {string}      — formato 'YYYY-MM-DD'
       barbeiroId {string|null} — UUID do barbeiro (opcional).
                                  Quando fornecido, filtra apenas
                                  os horários DAQUELE profissional.

     IMPACTO NO BANCO:
       SELECT horario FROM agendamentos
         WHERE barbearia_slug = slug
           AND data            = dateStr
           AND status         != 'cancelado'
           [AND barbeiro_id   = barbeiroId]

     NOTA SOBRE STATUS BLOQUEADOS:
       A query usa `.neq('status', 'cancelado')`, portanto
       retorna horários com status: 'pendente', 'confirmado'
       e 'bloqueado'. TODOS esses são tratados como ocupados
       pela ui.js — evitando que clientes agendem sobre um
       bloqueio manual feito pelo barbeiro no dashboard.

     NOTA TÉCNICA — TIPO TIME DO POSTGRESQL:
       Se o campo `horario` for do tipo TIME (não TEXT),
       o Supabase retorna 'HH:MM:SS'. A ui.js usa
       `h.startsWith(slot)` para comparar corretamente
       com os slots no formato 'HH:MM'.

     RETORNA: array de strings de horário ou []
  ────────────────────────────────────────────────── */
  async fetchAgendamentos(slug, dateStr, barbeiroId = null) {
    if (!this.isConfigured()) return [];
    try {
      // UUID_REGEX: garante que barbeiroId é um UUID PostgreSQL válido
      // antes de usar como filtro (evita queries mal formadas)
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      let query = supabaseClient
        .from('agendamentos')
        .select('horario')
        .eq('barbearia_slug', slug)
        .eq('data', dateStr)
        .neq('status', 'cancelado');

      // Filtra pelo barbeiro somente quando um UUID válido é fornecido
      if (barbeiroId && UUID_RE.test(barbeiroId)) {
        query = query.eq('barbeiro_id', barbeiroId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ? data.map(a => String(a.horario)) : [];
    } catch (err) {
      console.warn('[api.js] fetchAgendamentos → erro:', err.message);
      return [];
    }
  },


  /* ──────────────────────────────────────────────────
     fetchPortfolio(slug)
     O QUE FAZ: Busca as últimas 12 imagens do portfólio
                da barbearia.
     PARÂMETROS:
       slug {string} — slug da barbearia
     IMPACTO NO BANCO:
       SELECT * FROM portfolio
         WHERE barbearia_slug = slug
         ORDER BY created_at DESC
         LIMIT 12
     RETORNA: array de itens ou DemoData.portfolio
  ────────────────────────────────────────────────── */
  async fetchPortfolio(slug) {
    if (!this.isConfigured()) return DemoData.portfolio;
    try {
      const { data, error } = await supabaseClient
        .from('portfolio')
        .select('*')
        .eq('barbearia_slug', slug)
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data?.length ? data : DemoData.portfolio;
    } catch (err) {
      console.warn('[api.js] fetchPortfolio → fallback demo:', err.message);
      return DemoData.portfolio;
    }
  },


  /* ──────────────────────────────────────────────────
     fetchReviews(slug)
     O QUE FAZ: Busca as avaliações mais recentes da
                barbearia.
     PARÂMETROS:
       slug {string} — slug da barbearia
     IMPACTO NO BANCO:
       SELECT * FROM reviews
         WHERE barbearia_slug = slug
         ORDER BY created_at DESC
         LIMIT 20
     RETORNA: array de reviews ou DemoData.reviews
  ────────────────────────────────────────────────── */
  async fetchReviews(slug) {
    if (!this.isConfigured()) return DemoData.reviews;
    try {
      const { data, error } = await supabaseClient
        .from('reviews')
        .select('*')
        .eq('barbearia_slug', slug)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data?.length ? data : DemoData.reviews;
    } catch (err) {
      console.warn('[api.js] fetchReviews → fallback demo:', err.message);
      return DemoData.reviews;
    }
  },


  /* ──────────────────────────────────────────────────
     saveAgendamento(payload)
     O QUE FAZ: Insere um novo agendamento na tabela
                `agendamentos`. Simula latência no modo demo.

     PARÂMETROS:
       payload {object} — objeto com os campos do agendamento:
         ├── servico_nome     {string}  — nome do serviço
         ├── servico_id       {string}  — UUID (só se não for demo)
         ├── cliente_nome     {string}  — nome do cliente
         ├── cliente_telefone {string}  — somente dígitos
         ├── data             {string}  — formato 'YYYY-MM-DD'
         ├── horario          {string}  — formato 'HH:MM'
         ├── status           {string}  — sempre 'pendente'
         ├── barbearia_slug   {string}  — slug (omitido no demo)
         └── barbeiro_id      {string}  — UUID (opcional)

     IMPACTO NO BANCO:
       INSERT INTO agendamentos VALUES (payload)

     RETORNA: { success: boolean, data?, error? }
  ────────────────────────────────────────────────── */
  async saveAgendamento(payload) {
    if (!this.isConfigured()) {
      // Simula latência de rede para parecer real na demo
      await new Promise(resolve => setTimeout(resolve, 800));
      return { success: true, demo: true };
    }
    try {
      const { data, error } = await supabaseClient
        .from('agendamentos')
        .insert([payload])
        .select();
      if (error) throw error;
      return { success: true, data };
    } catch (err) {
      console.error('[api.js] saveAgendamento → erro:', err.message);
      return { success: false, error: err.message };
    }
  },
};
