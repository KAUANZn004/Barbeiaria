'use strict';

const CLIENT_HOURS = [
  '09:00', '10:00', '11:00', '12:00', '13:00',
  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
];

const ClientState = {
  slug: '',
  barbershop: null,
  services: [],
  barbers: [],
  portfolio: [],
  selectedService: null,
  selectedBarber: null,
  selectedDate: null,
  selectedTime: null,
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
};

function clientToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = String(value || '');
  return node.innerHTML;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value) || 0);
}

function normalizeTime(value) {
  return String(value || '').slice(0, 5);
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    weekday: 'long',
  });
}

function getSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get('b') || '').trim().toLowerCase();
}

function setLoadingState() {
  document.getElementById('services-grid').innerHTML = '<p class="text-sm text-zinc-400">Selecione um barbeiro para ver os serviços disponíveis.</p>';
  document.getElementById('barbeiro-list').innerHTML = '<p class="text-sm text-zinc-400">Carregando equipe...</p>';
  document.getElementById('slots-grid').innerHTML = '';
}

function updateHero() {
  const name = document.getElementById('shop-name');
  const address = document.getElementById('shop-address');
  if (!ClientState.barbershop) return;

  name.textContent = ClientState.barbershop.nome || 'Barbearia';
  address.textContent = ClientState.barbershop.endereco || 'Endereço não informado.';
  document.title = `${ClientState.barbershop.nome} | Agendamento`;

  const whatsappLink = document.getElementById('whatsapp-link');
  const whatsapp = String(ClientState.barbershop.whatsapp || '').replace(/\D/g, '');
  if (whatsappLink) {
    if (whatsapp) {
      whatsappLink.href = `https://wa.me/${whatsapp}`;
      whatsappLink.hidden = false;
    } else {
      whatsappLink.hidden = true;
    }
  }
}

function renderServices() {
  const grid = document.getElementById('services-grid');
  if (!grid) return;

  // Enquanto nenhum barbeiro estiver selecionado, orienta o cliente.
  if (!ClientState.selectedBarber) {
    grid.innerHTML = '<p class="text-sm text-zinc-400">Selecione um barbeiro para ver os serviços disponíveis.</p>';
    return;
  }

  if (!ClientState.services.length) {
    grid.innerHTML = '<p class="text-sm text-zinc-400">Este profissional ainda não cadastrou serviços. Entre em contato com a barbearia.</p>';
    return;
  }

  /*
    EXIBIÇÃO DOS SERVIÇOS PERSONALIZADOS DO BARBEIRO:
    Cards gerados do array servicos_json: [{ nome, preco }].
    Não há campo 'duracao' neste JSON — exibimos apenas nome e preço.
    A classe 'is-selected' marca o serviço ativo visualmente.
  */
  grid.innerHTML = ClientState.services.map((service) => `
    <button type="button" class="service-card ${ClientState.selectedService?.id === service.id ? 'is-selected' : ''}" data-service-id="${service.id}">
      <strong class="block text-left text-sm">${escapeHtml(service.nome)}</strong>
      <span class="mt-3 block text-left text-sm font-bold text-[var(--gold)]">${formatCurrency(service.preco)}</span>
    </button>
  `).join('');
}

function renderBarbers() {
  const list = document.getElementById('barbeiro-list');
  const feedback = document.getElementById('barbeiro-feedback');
  if (!list || !feedback) return;

  const activeBarbers = ClientState.barbers.filter((barber) => (barber.status || 'ativo') === 'ativo');
  if (!activeBarbers.length) {
    list.innerHTML = '<p class="text-sm text-zinc-400">Nenhum barbeiro disponível no momento.</p>';
    feedback.textContent = 'A equipe ainda não possui colaboradores ativos.';
    return;
  }

  list.innerHTML = activeBarbers.map((barber) => `
    <button type="button" class="barber-card ${ClientState.selectedBarber?.id === barber.id ? 'is-selected' : ''}" data-barber-id="${barber.id}">
      <img class="barber-avatar" src="${escapeHtml(barber.foto_url || 'https://placehold.co/160x160?text=Barber')}" alt="Foto de ${escapeHtml(barber.nome)}">
      <p class="barber-name">${escapeHtml(barber.nome)}</p>
    </button>
  `).join('');

  feedback.textContent = ClientState.selectedBarber
    ? `Agenda de ${ClientState.selectedBarber.nome} pronta para consulta.`
    : 'Selecione um barbeiro para carregar a agenda.';
}

function renderPortfolio() {
  const grid = document.getElementById('portfolio-grid');
  if (!grid) return;

  if (!ClientState.portfolio.length) {
    grid.innerHTML = '<div class="portfolio-empty">Essa barbearia ainda não publicou trabalhos no portfólio.</div>';
    return;
  }

  grid.innerHTML = ClientState.portfolio.map((item) => `
    <article class="portfolio-item">
      <img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.descricao || 'Trabalho da barbearia')}">
      <div class="portfolio-item-caption">
        <p>${escapeHtml(item.descricao || 'Trabalho da barbearia')}</p>
      </div>
    </article>
  `).join('');
}

function updateSlotFeedback(message) {
  const feedback = document.getElementById('slot-feedback');
  if (feedback) feedback.textContent = message;
}

function updateSelectedDateLabel() {
  const label = document.getElementById('selected-date-label');
  if (!label) return;
  label.textContent = ClientState.selectedDate ? formatDisplayDate(ClientState.selectedDate) : '';

/**
 * Controla o bloqueio visual das etapas de data e horário.
 * Enquanto nenhum serviço for selecionado, calendário e slots ficam
 * desativados (section-locked) + notice informativa é exibida.
 */
function updateCalendarLock() {
  const locked = !ClientState.selectedService;
  document.getElementById('section-calendario')?.classList.toggle('section-locked', locked);
  document.getElementById('section-slots')?.classList.toggle('section-locked', locked);
  const notice = document.getElementById('calendar-lock-notice');
  if (notice) notice.hidden = !locked;
}
}

function renderCalendar() {
  const title = document.getElementById('calendar-month-title');
  const daysContainer = document.getElementById('calendar-days');
  if (!title || !daysContainer) return;

  const monthDate = new Date(ClientState.currentYear, ClientState.currentMonth, 1);
  title.textContent = monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  daysContainer.innerHTML = '';

  const firstWeekday = new Date(ClientState.currentYear, ClientState.currentMonth, 1).getDay();
  const totalDays = new Date(ClientState.currentYear, ClientState.currentMonth + 1, 0).getDate();
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  for (let i = 0; i < firstWeekday; i += 1) {
    const empty = document.createElement('div');
    daysContainer.appendChild(empty);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(ClientState.currentYear, ClientState.currentMonth, day);
    const button = document.createElement('button');
    const isPast = date < todayMidnight;
    const isSelected = ClientState.selectedDate && toISODate(ClientState.selectedDate) === toISODate(date);

    button.type = 'button';
    button.className = `day-btn ${isPast ? 'is-disabled' : ''} ${isSelected ? 'is-selected' : ''}`.trim();
    button.textContent = String(day);
    button.disabled = isPast;

    if (!isPast) {
      button.addEventListener('click', () => {
        ClientState.selectedDate = date;
        ClientState.selectedTime = null;
        renderCalendar();
        updateSelectedDateLabel();
        loadSlots().catch((error) => {
          console.error('[app.js] erro ao carregar horários:', error);
          updateSlotFeedback('Não foi possível carregar os horários.');
        });
      });
    }

    daysContainer.appendChild(button);
  }
}

function renderSlots(occupiedTimes) {
  const grid = document.getElementById('slots-grid');
  if (!grid) return;

  const occupiedSet = new Set((occupiedTimes || []).map(normalizeTime));
  grid.innerHTML = CLIENT_HOURS.map((time) => {
    const isOccupied = occupiedSet.has(time);
    const isSelected = ClientState.selectedTime === time;
    return `
      <button type="button" class="slot-btn ${isOccupied ? 'is-occupied' : ''} ${isSelected ? 'is-selected' : ''}" data-slot-time="${time}" ${isOccupied ? 'disabled' : ''}>
        ${time}
      </button>
    `;
  }).join('');

  if (occupiedSet.size === CLIENT_HOURS.length) {
    updateSlotFeedback('Todos os horários deste dia estão ocupados.');
  } else if (ClientState.selectedDate) {
    updateSlotFeedback('Escolha um horário livre para continuar.');
  }
}

async function loadSlots() {
  // Seleção de serviço é pré-requisito para exibir horários disponíveis.
  if (!ClientState.selectedService) {
    updateSlotFeedback('Selecione um serviço antes de escolher o horário.');
    return;
  }

  if (!ClientState.selectedBarber) {
    updateSlotFeedback('Selecione um barbeiro antes de ver horários.');
    return;
  }

  if (!ClientState.selectedDate) {
    updateSlotFeedback('Selecione uma data para carregar os horários.');
    return;
  }

  updateSlotFeedback('Verificando horários disponíveis...');
  const rows = await Api.getAppointmentsByDate(
    ClientState.slug,
    toISODate(ClientState.selectedDate),
    ClientState.selectedBarber.id,
  );

  renderSlots(rows.map((row) => row.horario));
}

function bindStaticEvents() {
  document.getElementById('prev-month')?.addEventListener('click', () => {
    if (ClientState.currentMonth === 0) {
      ClientState.currentMonth = 11;
      ClientState.currentYear -= 1;
    } else {
      ClientState.currentMonth -= 1;
    }
    renderCalendar();
  });

  document.getElementById('next-month')?.addEventListener('click', () => {
    if (ClientState.currentMonth === 11) {
      ClientState.currentMonth = 0;
      ClientState.currentYear += 1;
    } else {
      ClientState.currentMonth += 1;
    }
    renderCalendar();
  });

  document.getElementById('services-grid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-service-id]');
    if (!button) return;
    const serviceId = button.getAttribute('data-service-id');
    ClientState.selectedService = ClientState.services.find((service) => String(service.id) === String(serviceId)) || null;
    renderServices();
      updateCalendarLock();
      if (ClientState.selectedService) {
        updateSlotFeedback('Ótimo! Agora selecione uma data para carregar os horários.');
      }
  });

  document.getElementById('barbeiro-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-barber-id]');
    if (!button) return;
    const barberId = button.getAttribute('data-barber-id');
    const barber = ClientState.barbers.find((b) => String(b.id) === String(barberId)) || null;
    ClientState.selectedBarber = barber;
    ClientState.selectedDate = null;
    ClientState.selectedTime = null;
    ClientState.selectedService = null;

    /*
      FILTRAGEM DOS SERVIÇOS PERSONALIZADOS DO BARBEIRO:
      Cada profissional tem sua lista em barbeiros.servicos_json gravada
      no dashboard do colaborador: [{ nome, preco }].
      Não requer chamada de rede extra — getBarbersByBarbeariaId já
      retorna '*', que inclui servicos_json.
      Filtramos entradas sem nome para garantir integridade dos cards.
    */
    const barberServices = Array.isArray(barber?.servicos_json) ? barber.servicos_json : [];
    ClientState.services = barberServices
      .map((service, index) => ({
        id: service.id || `barber-svc-${index}`,
        nome: String(service.nome || '').trim(),
        preco: Number(service.preco || 0),
      }))
      .filter((service) => service.nome);

    renderBarbers();
    renderServices();
    updateCalendarLock();
    renderCalendar();
    updateSelectedDateLabel();
    document.getElementById('slots-grid').innerHTML = '';
    const feedbackMsg = ClientState.services.length
      ? 'Escolha um serviço para continuar.'
      : 'Este profissional ainda não cadastrou serviços.';
    updateSlotFeedback(feedbackMsg);
  });

  document.getElementById('slots-grid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-slot-time]');
    if (!button || button.disabled) return;
    ClientState.selectedTime = button.getAttribute('data-slot-time');
    loadSlots().catch(() => null);
  });

  document.getElementById('booking-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const clientName = String(document.getElementById('client-name')?.value || '').trim();
    const clientPhone = String(document.getElementById('client-phone')?.value || '').replace(/\D/g, '');

    if (!ClientState.selectedService) {
      clientToast('Selecione um serviço antes de finalizar.');
      return;
    }
    if (!ClientState.selectedBarber) {
      clientToast('Selecione um barbeiro antes de finalizar.');
      return;
    }
    if (!ClientState.selectedDate || !ClientState.selectedTime) {
      clientToast('Selecione data e horário antes de finalizar.');
      return;
    }
    if (!clientName || !clientPhone) {
      clientToast('Preencha nome e WhatsApp para concluir.');
      return;
    }

    const confirmButton = document.getElementById('confirm-btn');
    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.textContent = 'Confirmando...';
    }

    try {
      await Api.createAppointment({
        barbearia_slug: ClientState.slug,
        barbeiro_id: ClientState.selectedBarber.id,
        data: toISODate(ClientState.selectedDate),
        horario: ClientState.selectedTime,
        status: 'pendente',
        cliente_nome: clientName,
        cliente_telefone: clientPhone,
        servico_nome: ClientState.selectedService.nome,
      });

      clientToast('Agendamento enviado com sucesso.');
      document.getElementById('booking-form').reset();
      ClientState.selectedTime = null;
      await loadSlots();
    } catch (error) {
      console.error('[app.js] erro ao criar agendamento:', error);
      clientToast(error?.message || 'Não foi possível concluir o agendamento.');
    } finally {
      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Confirmar agendamento';
      }
    }
  });
}

async function bootstrapClientPage() {
  ClientState.slug = getSlugFromUrl();
  bindStaticEvents();
  renderCalendar();
  setLoadingState();
  updateCalendarLock();

  if (!ClientState.slug) {
    clientToast('Slug da barbearia não informado.');
    document.getElementById('shop-name').textContent = 'Barbearia não encontrada';
    document.getElementById('shop-address').textContent = 'Abra a página com um slug válido em ?b=...';
    return;
  }

  if (!Api.isReady()) {
    clientToast('Supabase indisponível no momento.');
    return;
  }

  try {
    const barbershop = await Api.getBarbershopBySlug(ClientState.slug);
    if (!barbershop) {
      document.getElementById('shop-name').textContent = 'Barbearia não encontrada';
      document.getElementById('shop-address').textContent = `Nenhum cadastro ativo para o slug ${ClientState.slug}.`;
      clientToast('Slug inválido ou barbearia indisponível.');
      return;
    }

    ClientState.barbershop = barbershop;
    updateHero();

    const [barbers, portfolio] = await Promise.all([
      Api.getBarbersByBarbeariaId(barbershop.id),
      Api.getPortfolioByBarbearia(barbershop.id),
    ]);

    // Serviços serão carregados dinamicamente de servicos_json ao selecionar barbeiro
    ClientState.services = [];
    ClientState.barbers = barbers || [];
    ClientState.portfolio = portfolio || [];

    renderServices();
    renderBarbers();
    renderPortfolio();
    updateCalendarLock();
    updateSlotFeedback('Selecione um barbeiro para começar.');
  } catch (error) {
    console.error('[app.js] erro ao inicializar fluxo cliente:', error);
    document.getElementById('shop-name').textContent = 'Erro ao carregar a barbearia';
    document.getElementById('shop-address').textContent = 'Confira as tabelas e políticas do projeto antes de tentar novamente.';
    clientToast('Não foi possível carregar os dados da página.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrapClientPage().catch((error) => {
    console.error('[app.js] falha fatal:', error);
    clientToast('Falha ao iniciar a página de agendamento.');
  });
});