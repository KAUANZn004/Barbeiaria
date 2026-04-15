/* =========================================================
   colaborador.js
   Responsabilidade: dashboard completo do colaborador.

   Módulos internos:
   1) Guard de sessão manual por colaborador id
   2) Upload de foto com Cropper.js e Supabase Storage
   3) Editor dinâmico de serviços com nome + preço
   4) Persistência do array em servicos_json
   5) Gestão da agenda própria (hoje, próximos, bloqueios)
========================================================= */

'use strict';

const PROFILE_BUCKET = 'barbeiros-perfis';
const PROFILE_PLACEHOLDER = 'https://placehold.co/320x320?text=Avatar';
const QUICK_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];

const CollaboratorState = {
  colaborador: null,
  barbearia: null,
  services: [],
  pendingAvatarBlob: null,
  pendingRemoveAvatar: false,
  cropper: null,
  selectedDate: '',
  blockedSlots: [],
};

// Armazena { data, hora } durante revisão do modal de conflito para execução deferida.
let pendingBlockAction = null;

function collabToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function clearCollaboratorSession() {
  localStorage.removeItem('barbersaas.collab_id');
  localStorage.removeItem('barbersaas.slug');
  localStorage.removeItem('colaborador_logado');
}

function readCollaboratorSessionId() {
  return String(localStorage.getItem('barbersaas.collab_id') || '').trim();
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function normalizeTime(timeValue) {
  return String(timeValue || '').slice(0, 5);
}

function formatDateBR(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = String(isoDate).split('-');
  return `${day}/${month}/${year}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value) || 0);
}

function buildServiceDraft(service = {}) {
  return {
    id: service.id || crypto.randomUUID(),
    nome: String(service.nome || '').trim(),
    preco: Number(service.preco || 0),
    mode: service.mode || 'view',
  };
}

function openCropperModal() {
  const modal = document.getElementById('collab-cropper-modal');
  if (!modal) return;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeCropperModal() {
  const modal = document.getElementById('collab-cropper-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');

  if (CollaboratorState.cropper) {
    CollaboratorState.cropper.destroy();
    CollaboratorState.cropper = null;
  }
}

function updateAvatarPreview(src) {
  const preview = document.getElementById('collab-avatar-preview');
  if (!preview) return;
  preview.src = src || PROFILE_PLACEHOLDER;
}

function syncHeader() {
  const title = document.getElementById('collab-title');
  const subtitle = document.getElementById('collab-subtitle');
  if (title && CollaboratorState.colaborador && CollaboratorState.barbearia) {
    title.textContent = `${CollaboratorState.colaborador.nome} · ${CollaboratorState.barbearia.nome}`;
  }
  if (subtitle && CollaboratorState.colaborador) {
    subtitle.textContent = `Acesso validado pelo id local (${CollaboratorState.colaborador.id}). Gerencie foto, serviços e horários.`;
  }
}

function renderServicesEditor() {
  const list = document.getElementById('collab-services-list');
  const empty = document.getElementById('collab-services-empty');
  if (!list || !empty) return;

  if (!CollaboratorState.services.length) {
    empty.hidden = false;
    list.innerHTML = '';
    return;
  }

  empty.hidden = true;
  list.innerHTML = CollaboratorState.services.map((service) => {
    if (service.mode === 'edit') {
      return `
        <article class="service-editor-item" data-service-id="${service.id}">
          <div class="service-editor-grid">
            <input class="input-premium" data-service-name="${service.id}" type="text" placeholder="Nome do serviço" value="${escapeHtml(service.nome)}">
            <div class="price-input-wrap">
              <span class="price-prefix">R$</span>
              <input class="input-premium price-input" data-service-price="${service.id}" type="number" min="0" step="0.01" placeholder="0,00" value="${Number(service.preco || 0)}">
            </div>
            <div class="service-editor-actions">
              <button class="service-icon-btn" type="button" data-service-action="save" data-service-id="${service.id}" aria-label="Salvar serviço">✓</button>
              <button class="service-icon-btn is-danger" type="button" data-service-action="remove" data-service-id="${service.id}" aria-label="Remover serviço">🗑</button>
            </div>
          </div>
        </article>
      `;
    }

    return `
      <article class="service-editor-item" data-service-id="${service.id}">
        <div class="service-editor-summary">
          <div>
            <p class="service-editor-name">${escapeHtml(service.nome)}</p>
            <p class="service-editor-price">${formatCurrency(service.preco)}</p>
          </div>
          <div class="service-editor-actions">
            <button class="service-icon-btn" type="button" data-service-action="edit" data-service-id="${service.id}" aria-label="Editar serviço">✎</button>
            <button class="service-icon-btn is-danger" type="button" data-service-action="remove" data-service-id="${service.id}" aria-label="Excluir serviço">🗑</button>
          </div>
        </div>
        <p class="service-editor-hint">Item salvo no array JSON e disponível para edição posterior.</p>
      </article>
    `;
  }).join('');
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = String(value || '');
  return node.innerHTML;
}

function addServiceRow() {
  CollaboratorState.services.push(buildServiceDraft({ mode: 'edit' }));
  renderServicesEditor();
}

function findService(serviceId) {
  return CollaboratorState.services.find((item) => String(item.id) === String(serviceId));
}

function validateAndCommitService(serviceId) {
  const service = findService(serviceId);
  if (!service) return;

  const nameInput = document.querySelector(`[data-service-name="${serviceId}"]`);
  const priceInput = document.querySelector(`[data-service-price="${serviceId}"]`);
  const nome = String(nameInput?.value || '').trim();
  const preco = Number(priceInput?.value || 0);

  if (!nome) {
    collabToast('Informe o nome do serviço.');
    nameInput?.focus();
    return;
  }

  if (!Number.isFinite(preco) || preco < 0) {
    collabToast('Informe um preço válido para o serviço.');
    priceInput?.focus();
    return;
  }

  service.nome = nome;
  service.preco = preco;
  service.mode = 'view';
  renderServicesEditor();
}

function bindServicesEditor() {
  const addButton = document.getElementById('collab-service-add');
  const list = document.getElementById('collab-services-list');

  addButton?.addEventListener('click', addServiceRow);

  list?.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-service-action]');
    if (!actionButton) return;

    const action = actionButton.getAttribute('data-service-action');
    const serviceId = actionButton.getAttribute('data-service-id');
    const service = findService(serviceId);
    if (!service) return;

    if (action === 'edit') {
      service.mode = 'edit';
      renderServicesEditor();
      return;
    }

    if (action === 'save') {
      validateAndCommitService(serviceId);
      return;
    }

    if (action === 'remove') {
      CollaboratorState.services = CollaboratorState.services.filter((item) => String(item.id) !== String(serviceId));
      renderServicesEditor();
    }
  });
}

async function uploadAvatarIfNeeded() {
  if (!CollaboratorState.colaborador) return CollaboratorState.colaborador?.foto_url || null;

  if (CollaboratorState.pendingRemoveAvatar) {
    return null;
  }

  if (!CollaboratorState.pendingAvatarBlob) {
    return CollaboratorState.colaborador.foto_url || null;
  }

  const filePath = `${CollaboratorState.colaborador.barbearia_slug}/${CollaboratorState.colaborador.id}/avatar-${Date.now()}.jpg`;
  const { error } = await Api.client.storage
    .from(PROFILE_BUCKET)
    .upload(filePath, CollaboratorState.pendingAvatarBlob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) {
    throw new Error('Nao foi possivel enviar a foto. Verifique o bucket e as permissoes do Storage.');
  }

  const { data } = Api.client.storage.from(PROFILE_BUCKET).getPublicUrl(filePath);
  return data?.publicUrl || null;
}

async function saveProfile(event) {
  event.preventDefault();

  const hasEditingRow = CollaboratorState.services.some((item) => item.mode === 'edit');
  if (hasEditingRow) {
    collabToast('Salve ou remova os serviços em edição antes de continuar.');
    return;
  }

  const sanitizedServices = CollaboratorState.services.map((service) => ({
    nome: String(service.nome || '').trim(),
    preco: Number(service.preco || 0),
  })).filter((service) => service.nome);

  if (!sanitizedServices.length) {
    collabToast('Adicione pelo menos um serviço para salvar o perfil.');
    return;
  }

  const saveButton = document.getElementById('collab-profile-save');
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = 'Salvando perfil...';
  }

  try {
    const fotoUrl = await uploadAvatarIfNeeded();
    const precoBase = sanitizedServices.length ? sanitizedServices[0].preco : CollaboratorState.colaborador.preco_base;

    /*
      LOGICA DE SALVAMENTO DO ARRAY DE SERVICOS
      1) O estado local guarda cada linha como { nome, preco, mode }.
      2) Antes de persistir, removemos o campo mode e ficamos apenas com:
         [{ nome: 'Degrade', preco: 35.00 }, ...]
      3) Esse array e enviado para Api.updateBarberProfile(), que grava em
         barbeiros.servicos_json e atualiza um resumo textual em barbeiros.servicos.
      4) Ao recarregar a pagina, a leitura de servicos_json reconstrói a lista.
    */
    const updated = await Api.updateBarberProfile(CollaboratorState.colaborador.id, {
      fotoUrl,
      servicos: sanitizedServices,
      precoBase,
    });

    CollaboratorState.colaborador = updated;
    CollaboratorState.services = (updated.servicos_json || []).map((service) => buildServiceDraft(service));
    CollaboratorState.pendingAvatarBlob = null;
    CollaboratorState.pendingRemoveAvatar = false;
    updateAvatarPreview(updated.foto_url || PROFILE_PLACEHOLDER);
    renderServicesEditor();
    collabToast('Perfil atualizado com sucesso.');
  } catch (error) {
    console.error('[colaborador.js] erro ao salvar perfil:', error);
    collabToast(error?.message || 'Nao foi possivel salvar o perfil.');
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = 'Salvar perfil';
    }
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handlePhotoSelection(event) {
  const file = event.target.files?.[0];
  event.target.value = '';

  if (!file) return;
  if (!window.Cropper) {
    collabToast('Cropper.js nao carregou corretamente.');
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = document.getElementById('collab-cropper-image');
  if (!image) return;

  image.src = String(dataUrl);
  openCropperModal();

  image.onload = () => {
    if (CollaboratorState.cropper) {
      CollaboratorState.cropper.destroy();
    }

    CollaboratorState.cropper = new window.Cropper(image, {
      aspectRatio: 1,
      viewMode: 1,
      background: false,
      autoCropArea: 0.9,
      responsive: true,
    });
  };
}

async function confirmCroppedPhoto() {
  if (!CollaboratorState.cropper) return;

  const canvas = CollaboratorState.cropper.getCroppedCanvas({
    width: 720,
    height: 720,
    imageSmoothingQuality: 'high',
  });

  if (!canvas) {
    collabToast('Nao foi possivel gerar a foto recortada.');
    return;
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) {
    collabToast('Nao foi possivel preparar a foto para upload.');
    return;
  }

  CollaboratorState.pendingAvatarBlob = blob;
  CollaboratorState.pendingRemoveAvatar = false;
  updateAvatarPreview(canvas.toDataURL('image/jpeg', 0.9));
  closeCropperModal();
}

function bindAvatarControls() {
  const fileInput = document.getElementById('collab-photo-input');
  const changeButton = document.getElementById('collab-photo-change');
  const removeButton = document.getElementById('collab-photo-remove');
  const cropCancel = document.getElementById('collab-cropper-cancel');
  const cropClose = document.getElementById('collab-cropper-close');
  const cropConfirm = document.getElementById('collab-cropper-confirm');
  const cropModal = document.getElementById('collab-cropper-modal');

  changeButton?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (event) => {
    handlePhotoSelection(event).catch((error) => {
      console.error('[colaborador.js] erro ao preparar foto:', error);
      collabToast('Nao foi possivel carregar a imagem selecionada.');
    });
  });

  removeButton?.addEventListener('click', () => {
    CollaboratorState.pendingAvatarBlob = null;
    CollaboratorState.pendingRemoveAvatar = true;
    updateAvatarPreview(PROFILE_PLACEHOLDER);
    collabToast('Foto removida. Salve o perfil para confirmar.');
  });

  cropCancel?.addEventListener('click', closeCropperModal);
  cropClose?.addEventListener('click', closeCropperModal);
  cropConfirm?.addEventListener('click', () => {
    confirmCroppedPhoto().catch((error) => {
      console.error('[colaborador.js] erro no crop:', error);
      collabToast('Nao foi possivel confirmar o recorte.');
    });
  });

  cropModal?.addEventListener('click', (event) => {
    if (event.target === cropModal) {
      closeCropperModal();
    }
  });
}

function renderList(targetId, rows, formatter) {
  const list = document.getElementById(targetId);
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = '<li class="appt-item"><p class="text-sm text-zinc-400">Nenhum registro encontrado.</p></li>';
    return;
  }

  list.innerHTML = rows.map(formatter).join('');
}

function renderQuickSlots() {
  const grid = document.getElementById('collab-slots-grid');
  if (!grid) return;

  const blocked = new Set((CollaboratorState.blockedSlots || []).map((item) => normalizeTime(item.horario)));
  grid.innerHTML = QUICK_SLOTS.map((slot) => {
    const isBlocked = blocked.has(slot);
    return `
      <button type="button" class="slot-btn ${isBlocked ? 'collab-slot-blocked' : 'collab-slot-open'}" data-quick-slot="${slot}">
        ${slot}
      </button>
    `;
  }).join('');
}

async function refreshBlockedSlots() {
  if (!CollaboratorState.colaborador || !CollaboratorState.barbearia) return;

  const blocked = await Api.getBlockedSlots(
    CollaboratorState.barbearia.slug,
    todayISO(),
    CollaboratorState.colaborador.id,
  );

  CollaboratorState.blockedSlots = blocked;
  document.getElementById('collab-metric-blocked').textContent = String(blocked.length);

  renderList('collab-blocked-list', blocked, (item) => `
    <li class="block-item">
      <p class="text-sm font-semibold">${formatDateBR(item.data)} · ${normalizeTime(item.horario)}</p>
      <p class="mt-1 text-xs text-zinc-400">Bloqueio manual ativo</p>
    </li>
  `);

  renderQuickSlots();
}

async function refreshAgenda() {
  if (!CollaboratorState.colaborador || !CollaboratorState.barbearia) return;

  const today = todayISO();
  const todayAppointments = await Api.getAppointmentsByDate(
    CollaboratorState.barbearia.slug,
    today,
    CollaboratorState.colaborador.id,
  );
  const upcoming = await Api.getUpcomingAppointmentsByBarber(
    CollaboratorState.barbearia.slug,
    CollaboratorState.colaborador.id,
    today,
    20,
  );

  const activeToday = todayAppointments.filter((item) => item.status !== 'bloqueado');
  document.getElementById('collab-metric-total').textContent = String(activeToday.length);
  document.getElementById('collab-metric-upcoming').textContent = String(upcoming.filter((item) => item.status !== 'bloqueado').length);

  renderList('collab-today-list', todayAppointments, (item) => `
    <li class="appt-item">
      <p class="text-sm font-semibold">${normalizeTime(item.horario)} · ${escapeHtml(item.cliente_nome || 'Horario bloqueado')}</p>
      <p class="mt-1 text-xs text-zinc-300">${escapeHtml(item.servico_nome || 'Bloqueio manual')} · status: ${escapeHtml(item.status || 'pendente')}</p>
    </li>
  `);

  renderList('collab-upcoming-list', upcoming, (item) => `
    <li class="appt-item">
      <p class="text-sm font-semibold">${formatDateBR(item.data)} · ${normalizeTime(item.horario)}</p>
      <p class="mt-1 text-xs text-zinc-300">${escapeHtml(item.cliente_nome || 'Horario bloqueado')} · ${escapeHtml(item.servico_nome || 'Bloqueio manual')}</p>
    </li>
  `);
}

async function createManualBlock(dateValue, timeValue) {
  await Api.createBlockedSlot({
    barbearia_slug: CollaboratorState.barbearia.slug,
    barbeiro_id: CollaboratorState.colaborador.id,
    data: dateValue,
    horario: timeValue,
    status: 'bloqueado',
    cliente_nome: 'BLOQUEIO MANUAL',
    cliente_telefone: null,
    servico_nome: 'Bloqueio manual',
  });
}

async function deleteManualBlockByTime(timeValue) {
  const target = CollaboratorState.blockedSlots.find((item) => item.data === CollaboratorState.selectedDate && normalizeTime(item.horario) === timeValue);
  if (!target) {
    collabToast('Nenhum bloqueio encontrado para este horário.');
    return;
  }
  await Api.deleteBlockedSlot(target.id);
}

/**
 * VERIFICAÇÃO DE CONFLITOS (Regra de Ouro):
 * Consulta agendamentos reais (excluindo bloqueios) para um período
 * antes de permitir criação de bloqueio. Retorna count + lista de afetados.
 *
 * @param {string} data - Data no formato YYYY-MM-DD
 * @param {string|null} hora - HH:MM para slot único, null para dia inteiro
 */
async function verificarConflitos(data, hora) {
  const slug = CollaboratorState.barbearia.slug;
  const barbeiroId = CollaboratorState.colaborador.id;

  /*
    QUERY DE VERIFICAÇÃO ANTES DO INSERT DE BLOQUEIO:
    getAppointmentsByDate retorna todos os registros não-cancelados.
    Filtramos 'bloqueado' para obter apenas agendamentos reais de clientes.
    Quando 'hora' é informado, o filtro é afunilado para aquele slot específico.
  */
  const todos = await Api.getAppointmentsByDate(slug, data, barbeiroId);
  let conflitos = todos.filter((item) => item.status !== 'bloqueado');

  if (hora) {
    conflitos = conflitos.filter((item) => normalizeTime(item.horario) === hora);
  }

  return { hasConflicts: conflitos.length > 0, count: conflitos.length, appointments: conflitos };
}

/** Cria bloqueio para cada horário da grade padrão em uma data. */
async function bloquearTodosOsSlots(data) {
  for (const slot of QUICK_SLOTS) {
    try {
      await createManualBlock(data, slot);
    } catch (_) {
      // Ignora duplicata — slot pode já estar bloqueado
    }
  }
}

/**
 * Bloqueia o dia inteiro após verificar conflitos de agendamento.
 * Se houver agendamentos, abre modal de alerta para o colaborador decidir.
 */
async function bloquearDiaInteiro(data) {
  if (!CollaboratorState.colaborador || !CollaboratorState.barbearia) return;

  const { hasConflicts, count, appointments } = await verificarConflitos(data, null);

  if (hasConflicts) {
    pendingBlockAction = { data, hora: null };
    mostrarModalConflito(data, null, count, appointments);
  } else {
    await bloquearTodosOsSlots(data);
    await refreshBlockedSlots();
    await refreshAgenda();
    collabToast('Dia inteiro bloqueado com sucesso.');
  }
}

/**
 * ALERTA DE CONFLITO:
 * Exibe modal informando quantos agendamentos existem no período.
 * Lista os clientes afetados com links de WhatsApp para aviso rápido.
 */
function mostrarModalConflito(data, hora, count, appointments) {
  const modal = document.getElementById('conflict-modal');
  const message = document.getElementById('conflict-modal-message');
  const whatsappList = document.getElementById('conflict-whatsapp-list');
  if (!modal) return;

  const periodo = hora
    ? `${formatDateBR(data)} às ${hora}`
    : `dia ${formatDateBR(data)}`;

  if (message) {
    message.textContent = `Atenção! Existem ${count} agendamento(s) marcado(s) para ${periodo}. Deseja cancelar e notificar os clientes ou manter o bloqueio apenas nos horários vagos?`;
  }

  // Monta lista de clientes afetados com atalhos de WhatsApp
  if (whatsappList) {
    const comTelefone = appointments.filter((a) => a.cliente_telefone);
    if (comTelefone.length) {
      whatsappList.innerHTML = `
        <p class="conflict-whatsapp-title">Clientes afetados — avise pelo WhatsApp:</p>
        <ul class="conflict-client-list">
          ${appointments.map((a) => {
            const phone = String(a.cliente_telefone || '').replace(/\D/g, '');
            const waLink = phone
              ? `<a href="https://wa.me/55${phone}" target="_blank" rel="noopener noreferrer" class="conflict-whatsapp-link">&#128233; WhatsApp</a>`
              : '<span class="text-zinc-500 text-xs">Sem telefone</span>';
            return `<li class="conflict-client-item"><span>${escapeHtml(a.cliente_nome || 'Cliente')} &middot; ${normalizeTime(a.horario)}</span>${waLink}</li>`;
          }).join('')}
        </ul>
      `;
    } else {
      whatsappList.innerHTML = '<p class="text-xs text-zinc-500 mt-2">Nenhum telefone cadastrado para os clientes afetados.</p>';
    }
  }

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function fecharModalConflito() {
  const modal = document.getElementById('conflict-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

/**
 * Executa a ação de bloqueio escolhida pelo colaborador no modal de conflito.
 * @param {'cancelar-e-bloquear'|'bloquear-vagos'} action
 */
async function executarBloqueioComConflito(action) {
  if (!pendingBlockAction) return;
  const { data, hora } = pendingBlockAction;

  fecharModalConflito();
  pendingBlockAction = null;

  try {
    if (action === 'cancelar-e-bloquear') {
      // Cancela agendamentos reais do período e cria os bloqueios
      const { appointments } = await verificarConflitos(data, hora);
      for (const appt of appointments) {
        await Api.cancelAppointment(appt.id);
      }
      if (hora) {
        await createManualBlock(data, hora);
      } else {
        await bloquearTodosOsSlots(data);
      }
      collabToast(`${appointments.length} agendamento(s) cancelado(s). Período bloqueado.`);
    } else if (action === 'bloquear-vagos') {
      if (hora) {
        // Slot único com conflito: já tem agendamento, nada a bloquear
        collabToast('Horário possui agendamento ativo. Nenhum bloqueio criado.');
        return;
      }
      // Dia inteiro: bloqueia apenas slots sem agendamento
      const { appointments } = await verificarConflitos(data, null);
      const ocupados = new Set(appointments.map((a) => normalizeTime(a.horario)));
      const livres = QUICK_SLOTS.filter((slot) => !ocupados.has(slot));
      for (const slot of livres) {
        await createManualBlock(data, slot);
      }
      collabToast(`${livres.length} horário(s) vago(s) bloqueado(s).`);
    }

    await refreshBlockedSlots();
    await refreshAgenda();
  } catch (error) {
    console.error('[colaborador.js] erro ao executar bloqueio com conflito:', error);
    collabToast(error?.message || 'Nao foi possivel executar o bloqueio.');
  }
}

function bindBlockControls() {
  const dateInput = document.getElementById('collab-block-date');
  const timeInput = document.getElementById('collab-block-time');
  const form = document.getElementById('collab-block-form');
    const blockDayBtn = document.getElementById('collab-block-day-btn');
  const grid = document.getElementById('collab-slots-grid');

  if (dateInput) {
    dateInput.value = todayISO();
    CollaboratorState.selectedDate = dateInput.value;
    dateInput.addEventListener('change', () => {
      CollaboratorState.selectedDate = dateInput.value || todayISO();
      refreshBlockedSlots().catch((error) => {
        console.error('[colaborador.js] erro ao atualizar bloqueios:', error);
      });
    });
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const dateValue = dateInput?.value;
    const timeValue = timeInput?.value ? normalizeTime(timeInput.value) : '';

    if (!dateValue || !timeValue) {
      collabToast('Informe data e horário para bloquear.');
      return;
    }

    try {
      /*
        VERIFICAÇÃO DE CONFLITOS ANTES DO INSERT DE BLOQUEIO:
        A query detecta agendamentos reais no slot informado.
        Se houver, o modal de alerta é exibido para decisão do colaborador.
      */
      const { hasConflicts, count, appointments } = await verificarConflitos(dateValue, timeValue);

      if (hasConflicts) {
        pendingBlockAction = { data: dateValue, hora: timeValue };
        mostrarModalConflito(dateValue, timeValue, count, appointments);
        return;
      }

      await createManualBlock(dateValue, timeValue);
      await refreshBlockedSlots();
      await refreshAgenda();
      collabToast('Horário bloqueado com sucesso.');
      if (timeInput) timeInput.value = '';
    } catch (error) {
      console.error('[colaborador.js] erro ao criar bloqueio:', error);
      collabToast(error?.message || 'Nao foi possivel bloquear o horário.');
    }
  });

  grid?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-quick-slot]');
    if (!button) return;

    const timeValue = button.getAttribute('data-quick-slot');
    const selectedDate = CollaboratorState.selectedDate || todayISO();
    const isBlocked = button.classList.contains('collab-slot-blocked');

    try {
      if (isBlocked) {
        await deleteManualBlockByTime(timeValue);
        collabToast('Bloqueio removido.');
        await refreshBlockedSlots();
        await refreshAgenda();
      } else {
        // Verifica conflitos antes de bloquear o quick slot
        const { hasConflicts, count, appointments } = await verificarConflitos(selectedDate, timeValue);
        if (hasConflicts) {
          pendingBlockAction = { data: selectedDate, hora: timeValue };
          mostrarModalConflito(selectedDate, timeValue, count, appointments);
          return;
        }
        await createManualBlock(selectedDate, timeValue);
        collabToast('Horário bloqueado.');
        await refreshBlockedSlots();
        await refreshAgenda();
      }

      // BLOQUEAR DIA INTEIRO
      blockDayBtn?.addEventListener('click', async () => {
        const dateValue = dateInput?.value || todayISO();
        try {
          await bloquearDiaInteiro(dateValue);
        } catch (error) {
          console.error('[colaborador.js] erro ao bloquear dia inteiro:', error);
          collabToast(error?.message || 'Nao foi possivel bloquear o dia.');
        }
      });

      // Botões do modal de conflito
      document.getElementById('conflict-btn-cancel-block')?.addEventListener('click', () => {
        executarBloqueioComConflito('cancelar-e-bloquear').catch((error) => {
          console.error('[colaborador.js] erro ao cancelar-e-bloquear:', error);
          collabToast('Erro ao cancelar agendamentos e bloquear.');
        });
      });

      document.getElementById('conflict-btn-block-free')?.addEventListener('click', () => {
        executarBloqueioComConflito('bloquear-vagos').catch((error) => {
          console.error('[colaborador.js] erro ao bloquear vagos:', error);
          collabToast('Erro ao bloquear horários vagos.');
        });
      });

      document.getElementById('conflict-btn-abort')?.addEventListener('click', () => {
        fecharModalConflito();
        pendingBlockAction = null;
        collabToast('Bloqueio cancelado.');
      });

      document.getElementById('conflict-modal')?.addEventListener('click', (event) => {
        if (event.target === document.getElementById('conflict-modal')) {
          fecharModalConflito();
          pendingBlockAction = null;
        }
      });
    } catch (error) {
      console.error('[colaborador.js] erro ao alternar quick slot:', error);
      collabToast('Nao foi possivel alterar o bloqueio.');
    }
  });
}

function hydrateProfile() {
  if (!CollaboratorState.colaborador) return;
  updateAvatarPreview(CollaboratorState.colaborador.foto_url || PROFILE_PLACEHOLDER);
  CollaboratorState.services = (CollaboratorState.colaborador.servicos_json || []).map((service) => buildServiceDraft(service));
  renderServicesEditor();
}

async function bootstrapCollaboratorDashboard() {
  if (!Api.isReady()) {
    collabToast('Supabase indisponivel.');
    return;
  }

  // Lê o objeto completo salvo no login — fonte primária sem dependência de query
  let colaborador = null;
  try {
    const sessaoRaw = localStorage.getItem('colaborador_logado');
    if (sessaoRaw) {
      const parsed = JSON.parse(sessaoRaw);
      if (parsed && parsed.id) colaborador = parsed;
    }
  } catch (_) {
    // JSON inválido — trata como sessão ausente
  }

  // Fallback: tenta pelo collab_id via DB (mantém retrocompatibilidade)
  if (!colaborador) {
    const collabId = readCollaboratorSessionId();
    if (!collabId) {
      window.location.replace('portal.html');
      return;
    }
    colaborador = await Api.getCollaboratorById(collabId);
  }

  if (!colaborador || (colaborador.status && colaborador.status !== 'ativo')) {
    clearCollaboratorSession();
    window.location.replace('portal.html');
    return;
  }

  const barbearia = await Api.getBarbershopBySlug(colaborador.barbearia_slug);
  if (!barbearia) {
    clearCollaboratorSession();
    collabToast('Barbearia vinculada nao encontrada.');
    window.setTimeout(() => window.location.replace('portal.html'), 900);
    return;
  }

  CollaboratorState.colaborador = colaborador;
  CollaboratorState.barbearia = barbearia;
  localStorage.setItem('barbersaas.slug', String(colaborador.barbearia_slug || ''));

  syncHeader();
  hydrateProfile();
  bindServicesEditor();
  bindAvatarControls();
  bindBlockControls();
  document.getElementById('collab-profile-form')?.addEventListener('submit', saveProfile);

  await refreshAgenda();
  await refreshBlockedSlots();
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrapCollaboratorDashboard().catch((error) => {
    console.error('[colaborador.js] erro de inicializacao:', error);
    clearCollaboratorSession();
    window.location.replace('portal.html');
  });
});
