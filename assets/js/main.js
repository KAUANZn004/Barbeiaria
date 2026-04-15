/* ====================================================
   MAIN.JS — BarberSaaS
   Arquivo: assets/js/main.js

   RESPONSABILIDADE:
     Orquestração central da aplicação.
     Lê a URL, carrega os dados do banco, coordena
     o fluxo de agendamento e inicializa tudo.

   ARQUITETURA:
     AppState  → estado global (dados + seleções do usuário)
     Handlers  → respostas aos eventos do usuário
     App       → bootstrap + inicialização

   DEPENDÊNCIAS:
     Deve ser carregado DEPOIS de api.js e ui.js.
     Usa os objetos: Api, DemoData, Utils, Calendar, UI

   FLUXO COMPLETO:
     URL: /?b=<slug>&barbeiro_id=<uuid>&nome=<nome>&tel=<tel>
     1. App.init()          → detecta slug e parâmetros URL
     2. App.loadCoreData()  → busca barbearia + serviços
     3. Calendar.render()   → desenha o calendário do mês atual
     4. Usuário seleciona serviço → Handlers.selectService()
     5. Usuário seleciona data   → Handlers.selectDate()
        → atualizarGradeHorarios() busca ocupados no banco
        → UI.renderTimeSlots() marca ocupados visualmente
     6. Usuário seleciona horário → Handlers.selectTime()
     7. Usuário clica em Reservar → opens modal
     8. Confirma → Handlers.submitBooking() → Api.saveAgendamento()
   ==================================================== */

'use strict';


/* ──────────────────────────────────────────────────────
   APP STATE — ESTADO GLOBAL
   Objeto único que centraliza todos os dados da sessão
   do usuário. Nenhum estado deve ser guardado em
   variáveis soltas — tudo fica aqui para facilitar debug.
   ──────────────────────────────────────────────────── */
const AppState = {
  // Identificação da barbearia via URL (?b=<slug>)
  slug: 'demo',

  // Dados carregados do banco
  barbearia:            null,   // Objeto completo da barbearia
  servicos:             [],     // Array de serviços disponíveis
  agendamentosOcupados: [],     // Array de strings de horários ('HH:MM') já reservados no dia selecionado

  // Seleções ativas do usuário
  selectedService: null,   // Objeto de serviço selecionado
  selectedDate:    null,   // Objeto Date do dia selecionado
  selectedTime:    null,   // String 'HH:MM' do horário selecionado

  // Parâmetros opcionais (vindos do portal.html via URL)
  barbeiro_id:  null,  // UUID do barbeiro (filtra agendamentos para aquele profissional)
  clienteNome:  '',    // Pré-preenchimento do nome do cliente
  clienteTel:   '',    // Pré-preenchimento do telefone do cliente

  // Controle de navegação do calendário
  currentMonth: new Date().getMonth(),   // 0-indexado (0=Jan, 11=Dez)
  currentYear:  new Date().getFullYear(),
};


/* ──────────────────────────────────────────────────────
   HANDLERS — EVENTOS DO USUÁRIO
   Cada handler atualiza AppState, reflete na UI
   e dispara buscas no banco quando necessário.
   ──────────────────────────────────────────────────── */
const Handlers = {

  /**
   * Seleciona um serviço do menu.
   * Remove .selected de todos os cards e aplica no clicado.
   *
   * @param {Object}      servico — item do array AppState.servicos
   * @param {HTMLElement} card    — elemento DOM do card (.service-card)
   */
  selectService(servico, card) {
    // Remove destaque de todos os cards
    document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
    // Destaca o selecionado
    card.classList.add('selected');

    // Salva no estado
    AppState.selectedService = servico;

    // Navega automaticamente para a aba de agendamento
    Handlers.switchTab('booking');

    // Atualiza o texto do botão principal
    UI.updateActionButton();
  },

  /**
   * Seleciona um dia no calendário e busca os horários ocupados.
   *
   * @param {Date}        date — objeto Date do dia clicado
   * @param {HTMLElement} btn  — elemento DOM do botão do dia
   */
  async selectDate(date, btn) {
    // Remove seleção anterior no calendário
    document.querySelectorAll('.day-btn.selected').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    AppState.selectedDate = date;

    // Mostra "carregando..." na grade de slots enquanto busca
    const grade = document.getElementById('slots-grade');
    grade.innerHTML = '<div class="loading-slots">Verificando disponibilidade…</div>';

    // Busca os horários ocupados para esta data
    const dateStr     = Utils.formatDateForDB(date);
    const barbeiroId  = AppState.barbeiro_id;
    const barbeariaId = AppState.barbearia ? AppState.barbearia.id : null;

    await atualizarGradeHorarios(dateStr, barbeariaId, barbeiroId);

    // Atualiza o botão principal
    UI.updateActionButton();
  },

  /**
   * Seleciona um horário da grade.
   * Remove .selected dos demais e aplica no clicado.
   *
   * @param {string}      time — string 'HH:MM'
   * @param {HTMLElement} btn  — botão do slot de horário
   */
  selectTime(time, btn) {
    // Remove seleção anterior na grade
    document.querySelectorAll('.slot-hora.selected').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    AppState.selectedTime = time;
    UI.updateActionButton();
  },

  /**
   * Alterna entre abas do conteúdo principal.
   * Atualiza `.active` nos botões e `.hidden` nos painéis.
   *
   * @param {string} tabId — 'services' | 'booking' | 'portfolio' | 'reviews'
   */
  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `tab-${tabId}`);
    });
  },

  /**
   * Finaliza o agendamento.
   *
   * VALIDAÇÕES ANTES DE SALVAR:
   *   1. Campos de nome/telefone obrigatórios
   *   2. servicoId deve ser UUID válido para evitar FK error
   *      (em modo demo, IDs são '1', '2' etc — não são UUIDs)
   *   3. barbeiroId, se presente, deve ser UUID
   *   4. Em modo demo, `barbearia_slug` NÃO é incluído
   *      para evitar erro de violação de FK
   *
   * Após salvar, exibe toast, reseta estado e abre whatsapp.
   */
  async submitBooking() {
    const nome = document.getElementById('client-name').value.trim();
    const tel  = document.getElementById('client-tel').value.trim();

    if (!nome || !tel) {
      UI.showToast('Preencha seu nome e telefone para continuar.', 'error');
      return;
    }

    const { selectedService, selectedDate, selectedTime, slug } = AppState;
    const servicoId  = selectedService.id;
    const barbeiroId = AppState.barbeiro_id;

    /*
     * REGEX de validação de UUID v4 (padrão Supabase/Postgres).
     * IDs de dados demo como '1', '2' não passam nesta validação,
     * o que impede uma tentativa de INSERT inválida no banco real.
     */
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Monta o payload para inserção na tabela `agendamentos`
    const payload = {
      cliente_nome: nome,
      cliente_tel:  tel.replace(/\D/g, ''),          // Apenas números
      data:         Utils.formatDateForDB(selectedDate),
      horario:      selectedTime,
      servico_id:   UUID_REGEX.test(servicoId) ? servicoId : null,
      status:       'pendente',
    };

    // Inclui referência à barbearia apenas quando não está em modo demo
    if (slug !== 'demo') {
      payload.barbearia_slug = slug;
    }

    // Inclui barbeiro_id apenas se for UUID válido
    if (barbeiroId && UUID_REGEX.test(barbeiroId)) {
      payload.barbeiro_id = barbeiroId;
    }

    // Feedback visual: desativa botão durante o processamento
    const confirmBtn = document.getElementById('confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled    = true;
      confirmBtn.textContent = 'Salvando…';
    }

    const result = await Api.saveAgendamento(payload);

    if (confirmBtn) {
      confirmBtn.disabled    = false;
      confirmBtn.textContent = 'Confirmar Agendamento';
    }

    if (!result.success) {
      UI.showToast(`Erro ao agendar: ${result.error || 'Tente novamente.'}`, 'error', 5000);
      return;
    }

    // -------- SUCESSO --------
    UI.closeModal();
    UI.showToast('Agendamento realizado com sucesso! 🎉', 'success', 4000);
    this._resetBookingState();

    // Abre o WhatsApp com mensagem de confirmação pré-formatada
    if (AppState.barbearia && AppState.barbearia.whatsapp) {
      const num  = AppState.barbearia.whatsapp.replace(/\D/g, '');
      const msg  = encodeURIComponent(
        `Olá! Acabei de agendar online:\n` +
        `• Serviço: ${selectedService.nome}\n` +
        `• Data: ${Utils.formatDateDisplay(selectedDate)}\n` +
        `• Horário: ${selectedTime}\n` +
        `• Nome: ${nome}\n` +
        `Aguardo confirmação!`
      );
      setTimeout(() => window.open(`https://wa.me/${num}?text=${msg}`, '_blank'), 1200);
    }
  },

  /**
   * Reseta todas as seleções do usuário após um agendamento.
   * Preserva slug, barbearia, serviços e parâmetros URL.
   * @private
   */
  _resetBookingState() {
    AppState.selectedService = null;
    AppState.selectedDate    = null;
    AppState.selectedTime    = null;

    // Limpa destaques visuais
    document.querySelectorAll('.service-card.selected').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.day-btn.selected').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.slot-hora.selected').forEach(b => b.classList.remove('selected'));
    document.getElementById('slots-grade').innerHTML = '';

    UI.updateActionButton();
  },
};


/* ──────────────────────────────────────────────────────
   ATUALIZAR GRADE DE HORÁRIOS
   Função standalone mantida para compatibilidade e
   para uso direto (ex: ao mudar de barbeiro via URL).

   FLUXO COMPLETO:
   1. Recebe data (string 'YYYY-MM-DD') e barbeariaId
   2. Chama Api.fetchAgendamentos() filtrando pelo slug
      e opcionalmente pelo barbeiro_id
   3. Extrai apenas o campo `horario` (ex: '14:00')
   4. Passa o array de ocupados para UI.renderTimeSlots()
   5. UI desenha o slot como .ocupado ou clicável

   POR QUE USAMOS slug E NÃO barbeariaId DIRETO:
     A tabela `agendamentos` tem coluna `barbearia_slug` (FK).
     A função Api.fetchAgendamentos usa o slug do AppState.

   @param {string}      dataSelecionada — 'YYYY-MM-DD'
   @param {string|null} barbeariaId     — UUID (não usado na query, mantido na assinatura por retrocompatibilidade)
   @param {string|null} barbeiroId      — UUID (opcional, filtra por barbeiro)
   ──────────────────────────────────────────────────── */
async function atualizarGradeHorarios(dataSelecionada, barbeariaId, barbeiroId = null) {
  const result = await Api.fetchAgendamentos(AppState.slug, dataSelecionada, barbeiroId);

  if (!result.success) {
    UI.showToast('Erro ao buscar horários. Tente novamente.', 'error');
    AppState.agendamentosOcupados = [];
  } else {
    // Extrai apenas os strings de horário ('HH:MM') do resultado
    AppState.agendamentosOcupados = (result.data || []).map(a => a.horario);
  }

  UI.renderTimeSlots(AppState.agendamentosOcupados);
}


/* ──────────────────────────────────────────────────────
   APP — INICIALIZAÇÃO E BOOTSTRAP
   Responsável por ler a URL, carregar dados e montar
   todos os event listeners da página.
   ──────────────────────────────────────────────────── */
const App = {

  /**
   * Extrai o slug da barbearia da URL.
   *
   * COMO FUNCIONA:
   *   A URL do portal para o cliente é no formato:
   *   /?b=vzp   ou   /index.html?b=vzp
   *   window.location.search → '?b=vzp'
   *   URLSearchParams extrai o valor de 'b'
   *   Se não encontrado, usa 'demo' como fallback seguro.
   *
   * @returns {string} — slug ou 'demo'
   */
  getSlugFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('b') || 'demo';
  },

  /**
   * Lê parâmetros opcionais enviados pelo portal.html.
   *
   * O portal.html pré-preenche a URL com dados do cliente
   * quando um barbeiro inicia o agendamento por conta do cliente:
   *   ?b=vzp&barbeiro_id=<UUID>&nome=João da Silva&tel=11999887766
   *
   * Esses paramêtros:
   *   - barbeiro_id: filtra os agendamentos para o profissional
   *   - nome/tel: pré-preenche o formulário do modal
   */
  readURLParams() {
    const params = new URLSearchParams(window.location.search);

    const barbeiroId = params.get('barbeiro_id');
    const nome       = params.get('nome');
    const tel        = params.get('tel');

    if (barbeiroId) AppState.barbeiro_id = barbeiroId;
    if (nome)       AppState.clienteNome = decodeURIComponent(nome);
    if (tel)        AppState.clienteTel  = tel;
  },

  /**
   * Carrega barbearia e serviços do banco (ou dados demo).
   * Após carregar, atualiza o hero e renderiza os serviços.
   */
  async loadCoreData() {
    // Busca dados em paralelo para reduzir tempo de carregamento
    const [barbRes, servRes] = await Promise.all([
      Api.fetchBarbearia(AppState.slug),
      Api.fetchServicos(AppState.slug),
    ]);

    AppState.barbearia = barbRes.success ? barbRes.data : DemoData.barbearia;
    AppState.servicos  = servRes.success ? servRes.data : DemoData.servicos;

    // Atualiza o cabeçalho da página com nome, foto e rating
    UI.updateHero(AppState.barbearia);

    // Renderiza os cards de serviço
    UI.renderServices(AppState.servicos);

    // Carrega portfólio e reviews em background (sem bloquear a UI)
    this._loadSecondaryData();
  },

  /**
   * Carrega dados secundários depois que o core já está visível.
   * Portfólio e reviews são carregados em paralelo.
   * @private
   */
  async _loadSecondaryData() {
    const [portRes, revRes] = await Promise.all([
      Api.fetchPortfolio(AppState.slug),
      Api.fetchReviews(AppState.slug),
    ]);

    const portfolio = portRes.success ? portRes.data : DemoData.portfolio;
    const reviews   = revRes.success  ? revRes.data  : DemoData.reviews;

    UI.renderPortfolio(portfolio);
    UI.renderReviews(reviews, AppState.barbearia);
  },

  /**
   * Configura todos os event listeners estáticos da página.
   * Listeners dos cards de serviço e slots são criados
   * dinamicamente em UI.renderServices() e UI.renderTimeSlots().
   */
  setupEventListeners() {
    // ---- Navegação por abas ----
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => Handlers.switchTab(btn.dataset.tab));
    });

    // ---- Navegação do calendário ----
    document.getElementById('cal-prev').addEventListener('click', () => Calendar.prevMonth());
    document.getElementById('cal-next').addEventListener('click', () => Calendar.nextMonth());

    // ---- Botão de reservar (abre o modal) ----
    document.getElementById('book-btn').addEventListener('click', () => {
      if (!AppState.selectedService || !AppState.selectedDate || !AppState.selectedTime) return;
      UI.openModal();
    });

    // ---- Fechar modal (backdrop + botão X) ----
    document.getElementById('modal-close').addEventListener('click', () => UI.closeModal());
    document.getElementById('booking-modal').addEventListener('click', e => {
      // Fecha somente se clicar fora do conteúdo do modal (no backdrop escuro)
      if (e.target === e.currentTarget) UI.closeModal();
    });

    // ---- Confirmação do agendamento dentro do modal ----
    document.getElementById('confirm-btn').addEventListener('click', () => Handlers.submitBooking());

    // ---- Máscara de telefone no campo do modal ----
    const clienteTelInput = document.getElementById('client-tel');
    if (clienteTelInput) {
      clienteTelInput.addEventListener('input', e => {
        e.target.value = Utils.maskPhone(e.target.value);
      });
    }
  },

  /**
   * Preenche os campos do modal com dados vindos da URL.
   * Chamado após o DOM estar pronto.
   */
  prefillForm() {
    if (AppState.clienteNome) {
      const input = document.getElementById('client-name');
      if (input) input.value = AppState.clienteNome;
    }
    if (AppState.clienteTel) {
      const input = document.getElementById('client-tel');
      if (input) input.value = Utils.maskPhone(AppState.clienteTel);
    }
  },

  /**
   * Ponto de entrada principal da aplicação.
   * Executado quando o DOM está completamente carregado.
   *
   * SEQUÊNCIA:
   *   1. Lê slug + parâmetros da URL
   *   2. Configura listeners
   *   3. Renderiza o calendário (mês atual)
   *   4. Carrega dados do banco (assíncrono)
   *   5. Pré-preenche formulário (se veio do portal)
   */
  async init() {
    // 1. Identificação
    AppState.slug = this.getSlugFromURL();
    this.readURLParams();

    // 2. Eventos
    this.setupEventListeners();

    // 3. Calendário (renderiza imediatamente, sem esperar o banco)
    Calendar.render();

    // 4. Dados (assíncrono)
    await this.loadCoreData();

    // 5. Pré-preenche (para casos de acesso via portal)
    this.prefillForm();

    // Mostra banner se estiver em modo demonstração
    if (AppState.slug === 'demo' || !Api.isConfigured()) {
      UI.showToast('Modo demo ativo. Dados reais não serão salvos.', 'info', 6000);
    }
  },
};


/* ──────────────────────────────────────────────────────
   ENTRY POINT
   DOMContentLoaded garante que todos os elementos HTML
   já existem antes de começarmos a manipulá-los.
   ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => App.init());
