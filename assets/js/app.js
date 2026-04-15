/* ====================================================
   APP.JS — BarberSaaS — Dashboard do Barbeiro
   Arquivo: assets/js/app.js

   RESPONSABILIDADE:
     Toda a lógica do painel de controle do barbeiro:
     visualização de agenda, bloqueio de horários,
     gerenciamento de serviços e controle de conflitos.

   ORGANIZAÇÃO:
     ─ Funções Utilitárias
     ─ Estado Global (DashState)
     ─ Acesso ao Banco (DashData)
     ─ Funções de Agenda
     ─ Funções de KPI
     ─ Funções de Bloqueio
     ─ Funções de Serviços
     ─ Bloqueio Inteligente (conflito + WhatsApp)
     ─ Event Listeners
     ─ Inicialização (init)

   DEPENDÊNCIAS:
     api.js  → supabaseClient (config Supabase)
     auth.js → AuthService (sessão e papéis de acesso)

   MULTI-TENANCY:
     O filtro fundamental de toda query é `barbearia_slug`,
     que identifica de qual barbearia os dados pertencem.
     O campo está disponível em DashState.barbearia.slug
     após o login bem-sucedido.

     Barbeiros individuais têm um filtro adicional por
     `barbeiro_id = DashState.filterBarbeiroId`.
   ==================================================== */

'use strict';


/* ══════════════════════════════════════════════════════
   FUNÇÕES UTILITÁRIAS
   Funções puras sem efeitos colaterais no DOM ou banco.
══════════════════════════════════════════════════════ */

/**
 * Retorna a data de hoje no formato ISO (YYYY-MM-DD).
 * Usado como valor padrão para inputs de data.
 * @returns {string}
 */
function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Converte data ISO para formato brasileiro.
 * @param   {string} iso — 'YYYY-MM-DD'
 * @returns {string}     — 'DD/MM/YYYY'
 */
function formatDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Timer interno do toast (evita sobrepor toasts). */
let _toastTimer;

/**
 * Exibe uma notificação flutuante temporária.
 * @param {string} msg  — texto a exibir
 * @param {string} type — 'info' | 'success' | 'error'
 * @param {number} ms   — duração em ms (padrão: 3000)
 */
function showToast(msg, type = 'info', ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, ms);
}

/**
 * Sanitiza strings para uso seguro como innerHTML.
 * SEGURANÇA: previne XSS ao converter caracteres HTML
 * especiais em entidades — nunca insira texto externo
 * sem antes sanitizar.
 * @param   {*}      str
 * @returns {string} string sanitizada
 */
function sanitize(str) {
  const t = document.createElement('span');
  t.textContent = String(str ?? '');
  return t.innerHTML;
}


/* ══════════════════════════════════════════════════════
   ESTADO GLOBAL DO DASHBOARD
   Objeto único com tudo que o dashboard precisa em
   memória. Evita variáveis soltas e facilita debug.
══════════════════════════════════════════════════════ */
const DashState = {
  barbearia:         null,  // Dados completos da barbearia { id, slug, nome, whatsapp }
  user:              null,  // User do Supabase Auth
  date:              '',    // Data selecionada na agenda (YYYY-MM-DD)
  role:              null,  // 'dono' | 'barbeiro'
  barbeiro:          null,  // Objeto barbeiro individual (null quando dono)
  filterBarbeiroId:  null,  // UUID do barbeiro atualmente filtrado (null = todos)
};


/* ══════════════════════════════════════════════════════
   ACESSO AO BANCO DE DADOS (DashData)
   Todas as queries Supabase do dashboard ficam aqui,
   sejam SELECT, INSERT, UPDATE ou DELETE.
   Nenhuma função de render deve acessar diretamente o
   supabaseClient — sempre via DashData.
══════════════════════════════════════════════════════ */
const DashData = {

  /* ── Funções do Calendário / Agenda ──────────────── */

  /**
   * Busca todos os agendamentos de um dia específico.
   *
   * MULTI-TENANCY:
   *   O filtro `barbearia_slug` isola os dados da barbearia
   *   correta. O RLS (Row Level Security) do Supabase
   *   garante que mesmo sem o filtro, o usuário só veria
   *   seus próprios registros — mas usar o filtro explícito
   *   é uma boa prática de segurança e performance.
   *
   * JOIN:
   *   `barbeiros(nome)` faz um JOIN automático via FK para
   *   exibir o nome do profissional responsável no card.
   *
   * @param   {string} dateStr — 'YYYY-MM-DD'
   * @returns {Array}  lista de agendamentos ordenada por horário
   */
  async fetchAgendamentos(dateStr) {
    let query = supabaseClient
      .from('agendamentos')
      .select('id, horario, cliente_nome, servico_nome, status, cliente_telefone, barbeiro_id, barbeiros(nome)')
      .eq('barbearia_slug', DashState.barbearia.slug)
      .eq('data', dateStr)
      .order('horario', { ascending: true });

    // Filtro opcional por barbeiro (dono pode ver todos ou filtrar por profissional)
    if (DashState.filterBarbeiroId) {
      query = query.eq('barbeiro_id', DashState.filterBarbeiroId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Busca todos os bloqueios manuais futuros (hoje em diante).
   *
   * BLOQUEIOS:
   *   Bloqueios são registros na tabela `agendamentos` com
   *   status = 'bloqueado'. Não têm cliente real — usamos
   *   'cliente_nome: — Bloqueado —' como sentinel value.
   *
   * @returns {Array} bloqueios ordenados por data e hora
   */
  async fetchBloqueios() {
    let query = supabaseClient
      .from('agendamentos')
      .select('id, data, horario, barbeiro_id, barbeiros(nome)')
      .eq('barbearia_slug', DashState.barbearia.slug)
      .eq('status', 'bloqueado')
      .gte('data', todayISO())
      .order('data',   { ascending: true })
      .order('horario', { ascending: true });

    if (DashState.filterBarbeiroId) {
      query = query.eq('barbeiro_id', DashState.filterBarbeiroId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /* ── Funções de Serviços ─────────────────────────── */

  /**
   * Busca todos os serviços (ativos e inativos) da barbearia.
   * O dashboard exibe todos para que o dono possa gerenciá-los.
   * O index.html do cliente usa Api.fetchServicos() que filtra
   * apenas os ativos.
   *
   * @returns {Array} serviços ordenados por preço crescente
   */
  async fetchServicos() {
    const { data, error } = await supabaseClient
      .from('servicos')
      .select('id, nome, duracao, preco, ativo')
      .eq('barbearia_slug', DashState.barbearia.slug)
      .order('preco', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /* ── Funções de Agendamento ──────────────────────── */

  /**
   * Insere um bloqueio manual na tabela agendamentos.
   *
   * OPERAÇÃO DE BLOQUEIO:
   *   Um bloqueio é um INSERT com status='bloqueado',
   *   cliente_nome='— Bloqueado —' e telefone='0'.
   *   Isso faz com que o horário apareça como ocupado
   *   para os clientes na página de agendamento
   *   (Api.fetchAgendamentos filtra .neq('status','cancelado'),
   *   logo 'bloqueado' é tratado como ocupado).
   *
   * @param {string} dateStr — 'YYYY-MM-DD'
   * @param {string} timeStr — 'HH:MM'
   */
  async insertBloqueio(dateStr, timeStr) {
    const payload = {
      barbearia_slug:   DashState.barbearia.slug,
      cliente_nome:     '— Bloqueado —',
      cliente_telefone: '0',
      data:             dateStr,
      horario:          timeStr,
      status:           'bloqueado',
    };

    // Vincula o bloqueio ao barbeiro individual quando aplicável
    if (DashState.filterBarbeiroId) {
      payload.barbeiro_id = DashState.filterBarbeiroId;
    }

    const { data, error } = await supabaseClient
      .from('agendamentos')
      .insert([payload])
      .select();

    if (error) throw error;
    return data;
  },

  /**
   * Remove um agendamento ou bloqueio pelo ID.
   *
   * DELETE:
   *   Usado para remover bloqueios manuais ou limpar
   *   agendamentos cancelados da fila de visualização.
   *   O RLS garante que o usuário só pode deletar
   *   registros da sua própria barbearia.
   *
   * @param {string} id — UUID do registro
   */
  async deleteAgendamento(id) {
    const { error } = await supabaseClient
      .from('agendamentos')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  /**
   * Atualiza o status de um agendamento existente.
   *
   * UPDATE de status:
   *   O barbeiro pode mudar o status de:
   *   'pendente'   → 'confirmado' (confirmar presença)
   *   'confirmado' → 'cancelado'  (cliente não compareceu)
   *   Qualquer     → 'cancelado'  (cancelar por iniciativa)
   *
   * @param {string} id     — UUID do agendamento
   * @param {string} status — 'confirmado' | 'cancelado' | 'pendente'
   */
  async updateStatus(id, status) {
    const { error } = await supabaseClient
      .from('agendamentos')
      .update({ status })
      .eq('id', id);

    if (error) throw error;
  },

  /**
   * Alterna o campo `ativo` de um serviço no banco.
   *
   * UPDATE de serviço:
   *   Desativar um serviço (ativo=false) o esconde para
   *   os clientes, mas preserva o histórico de agendamentos
   *   que já usaram esse serviço.
   *
   * @param {string}  id    — UUID do serviço
   * @param {boolean} ativo — true para ativar, false para desativar
   */
  async toggleServico(id, ativo) {
    const { error } = await supabaseClient
      .from('servicos')
      .update({ ativo })
      .eq('id', id);

    if (error) throw error;
  },
};


/* ══════════════════════════════════════════════════════
   FUNÇÕES DE AGENDA
   Carregam e renderizam os agendamentos do dia.
══════════════════════════════════════════════════════ */

/**
 * Busca e renderiza a agenda de uma data.
 * Exibe skeletons enquanto carrega.
 * @param {string} dateStr — 'YYYY-MM-DD'
 */
async function loadAgenda(dateStr) {
  const list = document.getElementById('agenda-list');

  // Skeletons de carregamento (feedback visual imediato)
  list.innerHTML = `
    <div class="skeleton"></div>
    <div class="skeleton"></div>
    <div class="skeleton"></div>
  `;

  document.getElementById('agenda-date-subtitle').textContent =
    `— ${formatDateBR(dateStr)}`;

  try {
    const agendamentos = await DashData.fetchAgendamentos(dateStr);
    renderAgenda(agendamentos);
    updateKPIs(agendamentos);
  } catch (err) {
    list.innerHTML = `<p class="empty-state">Erro ao carregar agenda: ${sanitize(err.message)}</p>`;
    console.error('[Dashboard] loadAgenda:', err);
  }
}

/**
 * Cria os cards de agendamento no DOM.
 * Cada card exibe: horário, nome do cliente, serviço,
 * nome do barbeiro responsável e ações disponíveis.
 *
 * @param {Array} agendamentos — array retornado por DashData.fetchAgendamentos
 */
function renderAgenda(agendamentos) {
  const list = document.getElementById('agenda-list');

  if (!agendamentos.length) {
    list.innerHTML = '<p class="empty-state">Nenhum agendamento para este dia.</p>';
    return;
  }

  list.innerHTML = '';
  agendamentos.forEach(a => {
    // Normaliza 'HH:MM:SS' → 'HH:MM' (o Postgres TYPE TIME retorna com segundos)
    const timeDisplay = String(a.horario).slice(0, 5);
    const statusClass = a.status || 'pendente';

    const card = document.createElement('div');
    card.className = `appt-card ${statusClass}`;
    card.dataset.id = a.id;

    // Nome do barbeiro via JOIN barbeiros(nome)
    const barberName = a.barbeiros?.nome || null;

    // Monta o innerHTML com todos os campos sanitizados
    card.innerHTML = `
      <div class="appt-time">${sanitize(timeDisplay)}</div>
      <div class="appt-body">
        <div class="appt-name">${sanitize(a.cliente_nome)}</div>
        <div class="appt-service">
          ${sanitize(a.servico_nome || '—')}
          ${barberName
            ? `<span style="color:#666;margin-left:6px;">· ${sanitize(barberName)}</span>`
            : ''}
        </div>
        <div class="appt-actions">
          <span class="status-chip ${statusClass}">${sanitize(statusClass)}</span>
          ${a.status !== 'confirmado' && a.status !== 'bloqueado'
            ? `<button class="appt-action-btn" data-action="confirmar" data-id="${sanitize(a.id)}">✓ Confirmar</button>`
            : ''}
          ${a.status !== 'cancelado' && a.status !== 'bloqueado'
            ? `<button class="appt-action-btn danger" data-action="cancelar" data-id="${sanitize(a.id)}">✕ Cancelar</button>`
            : ''}
          ${a.status === 'bloqueado' || a.status === 'cancelado'
            ? `<button class="appt-action-btn danger" data-action="deletar" data-id="${sanitize(a.id)}">🗑 Remover</button>`
            : ''}
        </div>
      </div>
      ${a.cliente_telefone && a.cliente_telefone !== '0'
        ? `<a href="https://wa.me/${sanitize(a.cliente_telefone.replace(/\D/g,''))}"
             target="_blank" rel="noopener noreferrer"
             style="font-size:18px;align-self:center;flex-shrink:0;"
             title="Abrir WhatsApp">💬</a>`
        : ''}
    `;

    list.appendChild(card);
  });

  // Event delegation: um listener único para todos os botões da lista
  list.addEventListener('click', handleAgendaAction);
}

/**
 * Trata ações de confirmar, cancelar e deletar agendamentos.
 * Usa event delegation — o listener está na lista pai.
 *
 * @param {MouseEvent} e
 */
async function handleAgendaAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const { action, id } = btn.dataset;
  btn.disabled = true;

  try {
    if (action === 'confirmar') {
      await DashData.updateStatus(id, 'confirmado');
      showToast('Agendamento confirmado!', 'success');
    } else if (action === 'cancelar') {
      await DashData.updateStatus(id, 'cancelado');
      showToast('Agendamento cancelado.', 'info');
    } else if (action === 'deletar') {
      await DashData.deleteAgendamento(id);
      showToast('Registro removido.', 'info');
    }

    // Re-renderiza a lista após qualquer ação
    loadAgenda(DashState.date);
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error', 5000);
    btn.disabled = false;
  }
}


/* ══════════════════════════════════════════════════════
   FUNÇÕES DE KPI
   Atualiza os chips numéricos de resumo no topo.
══════════════════════════════════════════════════════ */

/**
 * Calcula e exibe os contadores do dia:
 *   - Total de agendamentos (todos os status)
 *   - Confirmados
 *   - Pendentes
 *
 * @param {Array} agendamentos — array completo do dia
 */
function updateKPIs(agendamentos) {
  document.getElementById('kpi-total').textContent =
    agendamentos.length;
  document.getElementById('kpi-confirmed').textContent =
    agendamentos.filter(a => a.status === 'confirmado').length;
  document.getElementById('kpi-pending').textContent =
    agendamentos.filter(a => a.status === 'pendente').length;
}


/* ══════════════════════════════════════════════════════
   FUNÇÕES DE BLOQUEIO MANUAL
   Carregam e exibem os bloqueios de horário ativos.
══════════════════════════════════════════════════════ */

/**
 * Busca e renderiza a lista de bloqueios manuais futuros.
 * Cada item permite remoção do bloqueio.
 */
async function loadBloqueios() {
  const list = document.getElementById('bloqueios-list');

  try {
    const bloqueios = await DashData.fetchBloqueios();

    if (!bloqueios.length) {
      list.innerHTML = '<p class="empty-state">Nenhum bloqueio ativo.</p>';
      return;
    }

    list.innerHTML = '';
    bloqueios.forEach(b => {
      const item = document.createElement('div');
      item.className = 'appt-card bloqueado';
      item.innerHTML = `
        <div class="appt-time">${sanitize(String(b.horario).slice(0, 5))}</div>
        <div class="appt-body">
          <div class="appt-name" style="color:#ef4444">Bloqueado</div>
          <div class="appt-service">${sanitize(formatDateBR(b.data))}</div>
          <div class="appt-actions">
            <span class="status-chip bloqueado">bloqueado</span>
            <button class="appt-action-btn danger" data-action="deletar" data-id="${sanitize(b.id)}">
              🗑 Remover
            </button>
          </div>
        </div>
      `;
      list.appendChild(item);
    });

    // Delegation para botões de remoção
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="deletar"]');
      if (!btn) return;
      btn.disabled = true;
      try {
        await DashData.deleteAgendamento(btn.dataset.id);
        showToast('Bloqueio removido.', 'success');
        loadBloqueios();
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
        btn.disabled = false;
      }
    });

  } catch (err) {
    list.innerHTML = `<p class="empty-state">Erro: ${sanitize(err.message)}</p>`;
  }
}


/* ══════════════════════════════════════════════════════
   FUNÇÕES DE SERVIÇOS
   Exibe e permite gerenciar os serviços da barbearia.
══════════════════════════════════════════════════════ */

/**
 * Busca e renderiza o grid de serviços cadastrados.
 * Cada card tem um botão para ativar/desativar o serviço.
 */
async function loadServicos() {
  const grid = document.getElementById('services-admin-grid');

  try {
    const servicos = await DashData.fetchServicos();

    if (!servicos.length) {
      grid.innerHTML = '<p class="empty-state">Nenhum serviço cadastrado.</p>';
      return;
    }

    grid.innerHTML = '';
    servicos.forEach(s => {
      const preco = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(s.preco);

      const card = document.createElement('div');
      card.className = 'service-admin-card';
      card.innerHTML = `
        <div class="sac-name">${sanitize(s.nome)}</div>
        <div class="sac-footer">
          <span class="sac-duration">⏱ ${sanitize(s.duracao)}min</span>
          <span class="sac-price">${sanitize(preco)}</span>
        </div>
        <button
          class="toggle-btn ${s.ativo ? 'ativo' : 'inativo'}"
          data-id="${sanitize(s.id)}"
          data-ativo="${s.ativo}"
        >
          ${s.ativo ? '● Ativo' : '○ Inativo'}
        </button>
      `;
      grid.appendChild(card);
    });

    // Toggle ativo/inativo via delegation
    grid.addEventListener('click', async (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;

      const novoAtivo = btn.dataset.ativo !== 'true';
      btn.disabled = true;

      try {
        await DashData.toggleServico(btn.dataset.id, novoAtivo);
        showToast(novoAtivo ? 'Serviço ativado.' : 'Serviço desativado.', 'info');
        loadServicos(); // Re-renderiza para refletir o novo estado
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
        btn.disabled = false;
      }
    });

  } catch (err) {
    grid.innerHTML = `<p class="empty-state">Erro: ${sanitize(err.message)}</p>`;
  }
}


/* ══════════════════════════════════════════════════════
   FUNÇÕES DO BARBEIRO (FILTRO DE PROFISSIONAL)
   Permite ao dono filtrar a agenda por barbeiro.
   Barbeiros individuais veem apenas a própria agenda.
══════════════════════════════════════════════════════ */

/**
 * Injeta um <select> de barbeiros acima da agenda
 * quando o usuário logado é o dono (tem todos os acessos).
 *
 * MULTI-TENANCY:
 *   Busca todos os barbeiros ativos pelo slug da barbearia,
 *   não por user_id — dono pode ver todos os profissionais.
 */
async function injectBarberFilter() {
  const row = document.getElementById('date-picker-row');

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'width:100%;padding:0 16px;margin-top:12px;';

  const sel = document.createElement('select');
  sel.id = 'filter-barber-select';
  sel.style.cssText = [
    'width:100%', 'background:#1c1c1c',
    'border:1px solid rgba(255,255,255,0.08)',
    'border-radius:12px', 'padding:10px 14px',
    "font-family:'Inter',sans-serif", 'font-size:13px',
    'color:#fff', 'outline:none', '-webkit-appearance:none',
    'appearance:none', 'cursor:pointer',
  ].join(';');

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Todos os profissionais';
  sel.appendChild(defaultOpt);

  try {
    const { data } = await supabaseClient
      .from('barbeiros')
      .select('id, nome')
      .eq('barbearia_slug', DashState.barbearia.slug)
      .eq('ativo', true)
      .order('nome', { ascending: true });

    (data || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.nome;
      sel.appendChild(opt);
    });
  } catch { /* silencioso — o select continua com a opção "Todos" */ }

  sel.addEventListener('change', () => {
    DashState.filterBarbeiroId = sel.value || null;
    loadAgenda(DashState.date);
  });

  wrapper.appendChild(sel);
  row.parentNode.insertBefore(wrapper, row.nextSibling);
}


/* ══════════════════════════════════════════════════════
   BLOQUEIO INTELIGENTE (TRATAMENTO DE CONFLITO)

   PROBLEMA:
     Se o barbeiro bloquear um horário que já tem um
     cliente agendado, o cliente fica sem aviso.

   SOLUÇÃO — fluxo em 3 etapas:
     1. verificarEBloquear() consulta o banco antes de bloquear.
        Se livre → INSERT direto (sem conflito).
        Se ocupado → showConflictModal() avisa o barbeiro.
     2. showConflictModal() exibe o nome do cliente e o horário,
        perguntando se o barbeiro quer cancelar e avisar.
     3. confirmConflictBlock():
        a. UPDATE status='cancelado' no agendamento
        b. INSERT novo bloqueio no horário
        c. Gera link wa.me com mensagem pré-escrita para
           o barbeiro contatar o cliente e remarcar.
══════════════════════════════════════════════════════ */

/** Armazena o alvo do conflito entre os passos 2 e 3. */
let _conflictTarget = null;

/**
 * PASSO 1 — Verifica conflito antes de bloquear.
 *
 * Consulta se existe agendamento ativo (não cancelado
 * e não bloqueado) para a data/hora informada.
 * Se livre: bloqueia direto.
 * Se ocupado: abre o modal de conflito.
 *
 * @param {string} data — 'YYYY-MM-DD'
 * @param {string} hora — 'HH:MM'
 */
async function verificarEBloquear(data, hora) {
  const barbeiroId = DashState.filterBarbeiroId || null;

  // SELECT para verificar se o slot está ocupado por cliente real
  let query = supabaseClient
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, status')
    .eq('barbearia_slug', DashState.barbearia.slug)
    .eq('data', data)
    .eq('horario', hora)
    .neq('status', 'cancelado')   // exclui cancelados
    .neq('status', 'bloqueado');  // exclui outros bloqueios

  if (barbeiroId) query = query.eq('barbeiro_id', barbeiroId);

  const { data: encontrados, error } = await query;
  if (error) throw error;

  if (!encontrados || encontrados.length === 0) {
    // ── Slot livre: bloqueia diretamente ──────────────
    await DashData.insertBloqueio(data, hora);
    showToast(`${hora} em ${formatDateBR(data)} bloqueado!`, 'success');
    document.getElementById('block-date').value = '';
    document.getElementById('block-time').value = '';
    loadBloqueios();
    if (DashState.date === data) loadAgenda(data);
  } else {
    // ── Slot ocupado: exibe modal de conflito ─────────
    showConflictModal(encontrados[0], data, hora);
  }
}

/**
 * PASSO 2 — Exibe o modal de conflito com dados do cliente.
 *
 * @param {Object} agendamento — registro do agendamento em conflito
 * @param {string} data        — 'YYYY-MM-DD'
 * @param {string} hora        — 'HH:MM'
 */
function showConflictModal(agendamento, data, hora) {
  // Guarda o alvo para uso no passo 3
  _conflictTarget = { agendamento, data, hora };

  const info = document.getElementById('conflict-info');
  info.textContent =
    `Cliente: ${agendamento.cliente_nome} — ${hora} em ${formatDateBR(data)}. ` +
    `Deseja cancelar o agendamento e entrar em contato para remarcar?`;

  // Oculta o botão de WhatsApp até a ação ser confirmada
  document.getElementById('conflict-whatsapp-btn').style.display = 'none';
  document.getElementById('conflict-confirm-btn').disabled    = false;
  document.getElementById('conflict-confirm-btn').textContent = 'Sim, cancelar agendamento';

  document.getElementById('conflict-modal').classList.add('show');
}

/** Fecha o modal de conflito sem executar ação. */
function closeConflictModal() {
  document.getElementById('conflict-modal').classList.remove('show');
  _conflictTarget = null;
}

/**
 * PASSO 3 — Cancela o agendamento, insere o bloqueio e
 * gera link de WhatsApp para o barbeiro contatar o cliente.
 *
 * SEQUÊNCIA:
 *   1. UPDATE agendamento.status = 'cancelado'
 *   2. INSERT novo registro com status = 'bloqueado'
 *   3. Monta URL wa.me com mensagem personalizada
 *   4. Exibe botão para abrir o WhatsApp
 */
async function confirmConflictBlock() {
  if (!_conflictTarget) return;

  const { agendamento, data, hora } = _conflictTarget;
  const confirmBtn = document.getElementById('conflict-confirm-btn');
  confirmBtn.disabled    = true;
  confirmBtn.textContent = 'Processando…';

  try {
    // 1. Cancela o agendamento do cliente
    await DashData.updateStatus(agendamento.id, 'cancelado');

    // 2. Insere o bloqueio no mesmo slot
    await DashData.insertBloqueio(data, hora);

    // 3. Monta mensagem de WhatsApp para remarcação
    const barbeariaNome = DashState.barbearia.nome || 'Barbearia';
    const msg = encodeURIComponent(
      `Olá ${agendamento.cliente_nome}, aqui é do ${barbeariaNome}. ` +
      `Tivemos um imprevisto e não poderemos atender no dia ${formatDateBR(data)} às ${hora}. ` +
      `Podemos remarcar para outro horário?`
    );
    const tel   = (agendamento.cliente_telefone || '').replace(/\D/g, '');
    const waUrl = `https://wa.me/${tel}?text=${msg}`;

    // 4. Exibe e configura o botão de WhatsApp
    const waBtn     = document.getElementById('conflict-whatsapp-btn');
    waBtn.style.display = 'block';
    waBtn.onclick   = () => window.open(waUrl, '_blank', 'noopener');

    confirmBtn.textContent = 'Bloqueio feito ✓';
    showToast(`${hora} em ${formatDateBR(data)} bloqueado!`, 'success');

    // Limpa os inputs do formulário de bloqueio
    document.getElementById('block-date').value = '';
    document.getElementById('block-time').value = '';

    // Atualiza as listas
    loadBloqueios();
    if (DashState.date === data) loadAgenda(data);

  } catch (err) {
    confirmBtn.disabled    = false;
    confirmBtn.textContent = 'Sim, cancelar agendamento';
    showToast(`Erro: ${err.message}`, 'error', 5000);
  }
}


/* ══════════════════════════════════════════════════════
   EVENT LISTENERS
   Registra todos os eventos de interação do dashboard.
   Centralizados aqui para facilitar manutenção.
══════════════════════════════════════════════════════ */

function setupEventListeners() {

  // ── Sair da conta ───────────────────────────────────
  document.getElementById('logout-btn').addEventListener('click', () => {
    AuthService.signOut();
  });

  // ── Ver página pública de agendamento ───────────────
  document.getElementById('view-public-btn').addEventListener('click', () => {
    const url = `index.html?b=${encodeURIComponent(DashState.barbearia.slug)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  // ── Navegação entre abas do dashboard ───────────────
  document.querySelectorAll('.dash-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dash-tab-btn').forEach(b  => b.classList.remove('active'));
      document.querySelectorAll('.dash-section').forEach(s  => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`dash-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ── Seletor de data na agenda ────────────────────────
  document.getElementById('reload-btn').addEventListener('click', () => {
    const v = document.getElementById('dash-date-input').value;
    if (!v) { showToast('Selecione uma data.', 'error'); return; }
    DashState.date = v;
    loadAgenda(v);
  });

  // Enter no input de data ativa o botão de recarregar
  document.getElementById('dash-date-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('reload-btn').click();
  });

  // ── Formulário de bloqueio manual ───────────────────
  document.getElementById('block-btn').addEventListener('click', async () => {
    const data = document.getElementById('block-date').value;
    const hora = document.getElementById('block-time').value;

    if (!data || !hora) {
      showToast('Preencha a data e o horário antes de bloquear.', 'error');
      return;
    }

    const btn = document.getElementById('block-btn');
    btn.disabled    = true;
    btn.textContent = 'Verificando…';

    try {
      await verificarEBloquear(data, hora);
    } catch (err) {
      showToast(`Erro: ${err.message}`, 'error', 5000);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Bloquear';
    }
  });

  // ── Modal de conflito ────────────────────────────────
  document.getElementById('conflict-cancel-btn').addEventListener('click', closeConflictModal);
  document.getElementById('conflict-confirm-btn').addEventListener('click', confirmConflictBlock);

  // Fechar ao clicar fora do card (no overlay escuro)
  document.getElementById('conflict-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('conflict-modal')) closeConflictModal();
  });
}


/* ══════════════════════════════════════════════════════
   INICIALIZAÇÃO DO DASHBOARD
   Ponto de entrada: verifica sessão, carrega dados
   e configura a interface.
══════════════════════════════════════════════════════ */

/**
 * Inicializa o dashboard após autenticação verificada.
 *
 * FLUXO:
 *   1. AuthService.requireBarbeiro() → verifica sessão + papel
 *      → se não autorizado, redireciona automaticamente
 *   2. Preenche DashState com os dados do usuário
 *   3. Se dono → injeta filtro de barbeiro
 *   4. Configura listeners de evento
 *   5. Carrega agenda do dia + serviços + bloqueios
 */
async function initDashboard() {
  // Guard de acesso — só barbeiros/donos chegam aqui
  const ctx = await AuthService.requireBarbeiro();
  if (!ctx) return; // Redirecionamento já foi executado em requireBarbeiro()

  // Popula o estado global
  DashState.user      = ctx.user;
  DashState.barbearia = ctx.barbearia;
  DashState.role      = ctx.role;
  DashState.barbeiro  = ctx.barbeiro;
  DashState.date      = todayISO();

  // Barbeiro individual → filtra automaticamente pelo próprio ID
  if (ctx.role === 'barbeiro' && ctx.barbeiro) {
    DashState.filterBarbeiroId = ctx.barbeiro.id;
  }

  // Atualiza título e badge no topbar
  document.getElementById('topbar-title').textContent = ctx.barbearia?.nome || 'Dashboard';
  const badge = document.getElementById('topbar-badge');
  badge.textContent = ctx.role === 'dono' ? 'DONO' : 'BARBEIRO';

  // Dono → exibe seletor de profissional
  if (ctx.role === 'dono') {
    await injectBarberFilter();
  }

  // Preenche input de data com hoje
  document.getElementById('dash-date-input').value = DashState.date;

  // Registra os eventos
  setupEventListeners();

  // Carrega dados iniciais em paralelo
  await Promise.all([
    loadAgenda(DashState.date),
    loadServicos(),
    loadBloqueios(),
  ]);
}

/* ── Entry Point ──────────────────────────────────── */
document.addEventListener('DOMContentLoaded', initDashboard);
