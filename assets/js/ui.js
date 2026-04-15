/* ====================================================
   UI.JS — BarberSaaS
   Arquivo: assets/js/ui.js

   RESPONSABILIDADE:
     Toda a manipulação do DOM: criar elementos HTML,
     atualizar textos, exibir/esconder componentes e
     renderizar listas dinâmicas.

   REGRA:
     Este arquivo NÃO deve fazer chamadas ao Supabase.
     Recebe dados já prontos de main.js e os exibe.

   DEPENDÊNCIAS:
     Deve ser carregado APÓS api.js.
     Usa as funções utilitárias do objeto `Utils`
     definido neste mesmo arquivo.

   EXPÕE:
     Utils   → funções puras (formatação, sanitização)
     Calendar → geração e navegação do calendário mensal
     UI       → renderização completa da interface
   ==================================================== */

'use strict';


/* ──────────────────────────────────────────────────────
   HORÁRIOS DE FUNCIONAMENTO
   Array com todos os slots de hora exibidos na grade.
   Edite aqui para ajustar o horário da barbearia.
   Padrão: 09:00 → 19:00, intervalos de 1 hora.
   ──────────────────────────────────────────────────── */
const BUSINESS_HOURS = [
  '09:00', '10:00', '11:00', '12:00', '13:00',
  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
];


/* ──────────────────────────────────────────────────────
   UTILS
   Funções puras sem efeitos colaterais no DOM.
   Podem ser chamadas de qualquer módulo.
   ──────────────────────────────────────────────────── */
const Utils = {

  /**
   * Formata um número como moeda BRL.
   * @param   {number} value — ex: 45
   * @returns {string}       — ex: "R$ 45,00"
   */
  formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  },

  /**
   * Formata um objeto Date para exibição amigável.
   * @param   {Date}   date
   * @returns {string} — ex: "segunda-feira, 14 de abril"
   */
  formatDateDisplay(date) {
    return date.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    });
  },

  /**
   * Formata um objeto Date para o formato do banco de dados.
   * @param   {Date}   date
   * @returns {string} — ex: "2026-04-14"
   */
  formatDateForDB(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  /**
   * Gera uma string de estrelas cheias e vazias.
   * @param   {number} nota — valor de 1 a 5
   * @returns {string}      — ex: "★★★★☆" para nota 4
   */
  renderStars(nota) {
    const full  = Math.round(Math.min(5, Math.max(0, nota)));
    const empty = 5 - full;
    return '★'.repeat(full) + '☆'.repeat(empty);
  },

  /**
   * Aplica máscara de telefone brasileiro.
   * @param   {string} value — string com ou sem máscara
   * @returns {string}       — ex: "(11) 99999-9999"
   */
  maskPhone(value) {
    return value
      .replace(/\D/g, '')
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d{1,4})$/, '$1-$2');
  },

  /**
   * Retorna a inicial em maiúsculo de um nome.
   * Usada para gerar avatares nos reviews.
   * @param   {string} name
   * @returns {string} — ex: "J" para "João"
   */
  getInitial(name) {
    return name ? name.trim().charAt(0).toUpperCase() : '?';
  },

  /**
   * Converte uma data para tempo relativo em PT-BR.
   * @param   {string} dateString — ISO 8601
   * @returns {string}            — ex: "Há 4 dias"
   */
  formatRelativeDate(dateString) {
    const diff = Date.now() - new Date(dateString).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Hoje';
    if (days === 1) return 'Ontem';
    if (days < 30)  return `Há ${days} dias`;
    if (days < 365) return `Há ${Math.floor(days / 30)} meses`;
    return `Há ${Math.floor(days / 365)} anos`;
  },

  /**
   * Sanitiza uma string para uso seguro em innerHTML.
   * SEGURANÇA: previne injeção de código XSS ao converter
   * caracteres HTML especiais (< > & " ') em entidades.
   * @param   {*}      str — qualquer valor (será convertido)
   * @returns {string}     — string sanitizada
   */
  sanitize(str) {
    const tmp = document.createElement('span');
    tmp.textContent = String(str ?? '');
    return tmp.innerHTML;
  },
};


/* ──────────────────────────────────────────────────────
   CALENDAR
   Responsável por desenhar a grade mensal no DOM e
   gerenciar a navegação entre meses.

   COMO FUNCIONA O CÁLCULO DE DIAS:
     1. `new Date(year, month, 1).getDay()` retorna o
        índice do dia da semana do 1° dia (0=Dom, 6=Sáb).
        Isso define quantas células vazias (.day-empty)
        precisamos antes do primeiro dia.
     2. `new Date(year, month + 1, 0).getDate()` usa o
        "dia 0 do próximo mês" para obter o último dia
        do mês atual — genericamente correto para
        meses com 28, 29, 30 ou 31 dias.
     3. Para cada dia, comparamos com `todayMidnight`
        (sem horas) para determinar se está no passado.
        Dias passados recebem .past e são desabilitados.
   ──────────────────────────────────────────────────── */
const Calendar = {

  MONTH_NAMES: [
    'Janeiro','Fevereiro','Março','Abril',
    'Maio','Junho','Julho','Agosto',
    'Setembro','Outubro','Novembro','Dezembro',
  ],

  /**
   * Renderiza a grade do mês/ano armazenados em AppState.
   * Chamado na inicialização e a cada navegação de mês.
   * Não recebe parâmetros — lê AppState.currentMonth e
   * AppState.currentYear diretamente.
   */
  render() {
    const { currentMonth, currentYear } = AppState;
    const today = new Date();

    // Atualiza o título ex: "Abril 2026"
    document.getElementById('calendar-month-title').textContent =
      `${this.MONTH_NAMES[currentMonth]} ${currentYear}`;

    const daysGrid = document.getElementById('calendar-days');
    daysGrid.innerHTML = '';

    // Índice do 1° dia do mês na semana (0=Dom … 6=Sáb)
    const firstWeekday = new Date(currentYear, currentMonth, 1).getDay();

    // Total de dias no mês: dia 0 do mês seguinte = último dia do atual
    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Meia-noite de hoje para comparação sem horário
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Células vazias para alinhar o 1° dia ao dia da semana correto
    for (let i = 0; i < firstWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'day-empty';
      daysGrid.appendChild(empty);
    }

    // Cria um <button> para cada dia do mês
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(currentYear, currentMonth, d);
      const btn  = document.createElement('button');
      btn.className    = 'day-btn';
      btn.textContent  = d;
      btn.dataset.date = Utils.formatDateForDB(date);
      btn.setAttribute('aria-label', `${d} de ${this.MONTH_NAMES[currentMonth]}`);

      // Marca o dia atual com a classe .today (bolinha dourada)
      const isToday = (
        d            === today.getDate()  &&
        currentMonth === today.getMonth() &&
        currentYear  === today.getFullYear()
      );
      if (isToday) btn.classList.add('today');

      // Dias passados: desabilita visualmente e impede clique
      const isPast = date < todayMidnight;
      if (isPast) {
        btn.classList.add('past');
        btn.disabled = true;
      } else {
        // Dias futuros e hoje: ativa o handler de seleção de data
        btn.addEventListener('click', () => Handlers.selectDate(date, btn));
      }

      // Mantém o destaque ao navegar entre meses (ex: clicou em maio,
      // voltou para abril — o dia de maio fica salvo no AppState)
      if (
        AppState.selectedDate &&
        AppState.selectedDate.getFullYear() === currentYear &&
        AppState.selectedDate.getMonth()    === currentMonth &&
        AppState.selectedDate.getDate()     === d
      ) {
        btn.classList.add('selected');
      }

      daysGrid.appendChild(btn);
    }
  },

  /** Navega para o mês anterior e re-renderiza. */
  prevMonth() {
    if (AppState.currentMonth === 0) {
      AppState.currentMonth = 11;
      AppState.currentYear--;
    } else {
      AppState.currentMonth--;
    }
    this.render();
  },

  /** Navega para o próximo mês e re-renderiza. */
  nextMonth() {
    if (AppState.currentMonth === 11) {
      AppState.currentMonth = 0;
      AppState.currentYear++;
    } else {
      AppState.currentMonth++;
    }
    this.render();
  },
};


/* ──────────────────────────────────────────────────────
   UI
   Todas as funções de manipulação do DOM.
   Recebe dados já processados como parâmetros.
   ──────────────────────────────────────────────────── */
const UI = {

  /* ── Toast de notificação ─────────────────────────── */

  /**
   * Exibe um toast (feedback rápido) por `duration` ms.
   * @param {string}  message  — texto a exibir
   * @param {string}  type     — 'info' | 'success' | 'error'
   * @param {number}  duration — millisegundos (padrão: 3000)
   */
  showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className   = `show ${type}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toast.className = ''; }, duration);
  },


  /* ── Botão de ação (rodapé) ───────────────────────── */

  /**
   * Atualiza o texto e o estado disabled do botão principal.
   * Guia o usuário pelos passos: serviço → data → horário.
   * Não recebe parâmetros — lê AppState diretamente.
   */
  updateActionButton() {
    const btn = document.getElementById('book-btn');
    const { selectedService, selectedTime, selectedDate } = AppState;

    if (selectedService && selectedDate && selectedTime) {
      btn.disabled    = false;
      btn.textContent = `Reservar — ${Utils.formatCurrency(selectedService.preco)}`;
    } else if (selectedService && !selectedDate) {
      btn.disabled    = true;
      btn.textContent = 'Agora selecione uma data';
    } else if (selectedService && selectedDate && !selectedTime) {
      btn.disabled    = true;
      btn.textContent = 'Agora selecione um horário';
    } else {
      btn.disabled    = true;
      btn.textContent = 'Selecione um serviço e horário';
    }
  },


  /* ── Modal de agendamento ─────────────────────────── */

  /**
   * Abre o bottom-sheet modal e preenche o resumo da seleção.
   * Usa Utils.sanitize() em todos os campos externos para
   * prevenir XSS caso um dado do banco contenha HTML.
   */
  openModal() {
    const { selectedService, selectedDate, selectedTime } = AppState;

    document.getElementById('booking-summary').innerHTML = `
      <div class="summary-row">
        <span class="summary-label">Serviço</span>
        <span class="summary-value">${Utils.sanitize(selectedService.nome)}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Data</span>
        <span class="summary-value">${Utils.formatDateDisplay(selectedDate)}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Horário</span>
        <span class="summary-value">${Utils.sanitize(selectedTime)}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Duração</span>
        <span class="summary-value">${Utils.sanitize(selectedService.duracao)} min</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Total</span>
        <span class="summary-value gold">${Utils.formatCurrency(selectedService.preco)}</span>
      </div>
    `;

    document.getElementById('booking-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Impede scroll do fundo enquanto o modal está aberto
  },

  /** Fecha o modal e restaura o scroll da página. */
  closeModal() {
    document.getElementById('booking-modal').classList.add('hidden');
    document.body.style.overflow = '';
  },


  /* ── Renderização dos serviços ────────────────────── */

  /**
   * Popula o grid de serviços, substituindo os skeletons.
   * Cada card recebe um listener de clique que chama
   * Handlers.selectService() em main.js.
   *
   * @param {Array} servicos — array de objetos serviço
   */
  renderServices(servicos) {
    const grid = document.getElementById('services-grid');
    grid.innerHTML = '';

    servicos.forEach(servico => {
      const card = document.createElement('div');
      card.className = 'service-card';
      card.dataset.id = servico.id;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${servico.nome}, ${Utils.formatCurrency(servico.preco)}`);

      card.innerHTML = `
        <div class="service-check" aria-hidden="true">✓</div>
        <div class="service-name">${Utils.sanitize(servico.nome)}</div>
        <div class="service-footer">
          <span class="service-duration">⏱ ${Utils.sanitize(servico.duracao)}min</span>
          <span class="service-price">${Utils.formatCurrency(servico.preco)}</span>
        </div>
      `;

      // Clique e teclado (Enter/Space) para acessibilidade
      card.addEventListener('click', () => Handlers.selectService(servico, card));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          Handlers.selectService(servico, card);
        }
      });

      grid.appendChild(card);
    });
  },


  /* ── Grade de horários ────────────────────────────── */

  /**
   * Renderiza todos os slots de horário para um dia.
   *
   * LÓGICA DE BLOQUEIO VISUAL:
   *   Para cada horário em BUSINESS_HOURS, verifica se ele
   *   está na lista `ocupados` (retornada pelo api.js).
   *   Se ocupado → classe .slot-hora.ocupado (CSS risca e bloqueia).
   *   Se livre   → classe .slot-hora + listener de seleção.
   *
   * NOTA: `ocupados` pode conter horários com status
   * 'pendente', 'confirmado' OU 'bloqueado' — todos tratados
   * igualmente como indisponíveis para o cliente.
   *
   * @param {string[]} ocupados — array de strings 'HH:MM' ou 'HH:MM:SS'
   */
  renderTimeSlots(ocupados) {
    const grade = document.getElementById('slots-grade');
    grade.innerHTML = '';

    // Reset do horário selecionado a cada troca de data
    AppState.selectedTime = null;
    this.updateActionButton();

    BUSINESS_HOURS.forEach(slot => {
      // `startsWith` suporta tanto 'HH:MM' quanto 'HH:MM:SS'
      // (tipo TIME nativo do PostgreSQL retorna com segundos)
      const ocupado = ocupados.some(h => String(h).startsWith(slot));

      const btn = document.createElement('button');
      btn.textContent  = slot;
      btn.dataset.time = slot;

      if (ocupado) {
        /*
         * SLOT OCUPADO:
         *   Desabilitamos por CSS (pointer-events: none + opacity)
         *   E também via `disabled = true` para garantir que
         *   tecnologias assistivas (leitores de tela) entendam
         *   que o slot não está disponível.
         */
        btn.className           = 'slot-hora ocupado';
        btn.style.pointerEvents = 'none';
        btn.disabled            = true;
        btn.setAttribute('aria-label', `${slot} — já reservado`);
      } else {
        btn.className = 'slot-hora';
        btn.setAttribute('aria-label', `Agendar às ${slot}`);
        btn.addEventListener('click', () => Handlers.selectTime(slot, btn));
      }

      grade.appendChild(btn);
    });
  },


  /* ── Portfólio ────────────────────────────────────── */

  /**
   * Popula o grid de portfólio com imagens lazy-loaded.
   * Imagens quebradas são tratadas com `onerror`.
   * @param {Array} items — array de itens de portfólio
   */
  renderPortfolio(items) {
    const grid = document.getElementById('portfolio-grid');

    if (!items || items.length === 0) {
      grid.innerHTML = '<p class="empty-state">Nenhum trabalho publicado ainda.</p>';
      return;
    }

    grid.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'portfolio-item';

      const img = document.createElement('img');
      img.src      = item.image_url;
      img.alt      = Utils.sanitize(item.descricao || 'Trabalho do portfólio');
      img.loading  = 'lazy';   // Carrega apenas quando entra no viewport
      img.decoding = 'async';  // Decodifica sem bloquear a thread principal

      img.onerror = () => { div.style.background = '#1a1a1a'; };
      div.appendChild(img);
      grid.appendChild(div);
    });
  },


  /* ── Reviews ──────────────────────────────────────── */

  /**
   * Renderiza o resumo de avaliação e os cards individuais.
   * @param {Array}  reviews   — array de avaliações
   * @param {Object} barbearia — dados da barbearia (para a nota média)
   */
  renderReviews(reviews, barbearia) {
    // Bloco de resumo: nota grande + total de avaliações
    if (barbearia) {
      const avg = Number(barbearia.avaliacao_media) || 0;
      document.getElementById('rating-big').textContent       = avg.toFixed(1);
      document.getElementById('rating-stars-big').textContent = Utils.renderStars(Math.round(avg));
      document.getElementById('rating-total').textContent     = `${barbearia.total_avaliacoes ?? 0} avaliações`;
    }

    const list = document.getElementById('reviews-list');
    if (!reviews || reviews.length === 0) {
      list.innerHTML = '<p class="empty-state">Nenhuma avaliação ainda. Seja o primeiro!</p>';
      return;
    }

    list.innerHTML = '';
    reviews.forEach(review => {
      const card = document.createElement('div');
      card.className = 'review-card';
      card.innerHTML = `
        <div class="review-header">
          <div class="review-author">
            <div class="review-avatar" aria-hidden="true">
              ${Utils.sanitize(Utils.getInitial(review.cliente_nome))}
            </div>
            <div>
              <div class="review-name">${Utils.sanitize(review.cliente_nome)}</div>
              <div class="review-date">${Utils.formatRelativeDate(review.created_at)}</div>
            </div>
          </div>
          <div class="review-stars" aria-label="Nota: ${review.nota} de 5">
            ${Utils.renderStars(review.nota)}
          </div>
        </div>
        <p class="review-text">${Utils.sanitize(review.comentario)}</p>
      `;
      list.appendChild(card);
    });
  },


  /* ── Hero Header ──────────────────────────────────── */

  /**
   * Atualiza o hero com os dados da barbearia.
   * Usa textContent (não innerHTML) para os campos de texto
   * para proteção automática contra XSS.
   * @param {Object} barbearia — dados vindos do api.js
   */
  updateHero(barbearia) {
    document.getElementById('shop-name').textContent    = barbearia.nome;
    document.getElementById('shop-address').textContent = barbearia.endereco;
    document.getElementById('hero-reviews-count').textContent =
      `${barbearia.total_avaliacoes} avaliações`;

    const avg = Number(barbearia.avaliacao_media) || 0;
    document.getElementById('hero-stars').textContent = Utils.renderStars(Math.round(avg));

    // Usa encodeURI para garantir que URLs com espaços ou caracteres especiais
    // não quebrem o background-image do CSS
    if (barbearia.hero_image) {
      document.getElementById('hero-bg').style.backgroundImage =
        `url('${encodeURI(barbearia.hero_image)}')`;
    }

    // Personaliza o <title> da aba do navegador
    document.title = `${barbearia.nome} — Agendamento Online`;
  },
};
