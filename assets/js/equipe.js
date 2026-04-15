/* =========================================================
   equipe.js
   Responsabilidade: gestão da equipe no dashboard do dono.

   Fluxos principais:
   1) Carregar sessão e validar papel dono
   2) Listar colaboradores e permitir ativar/inativar
   3) Cadastrar novo colaborador
   4) Excluir colaborador com confirmação (fluxo seguro)
========================================================= */

'use strict';

const OwnerState = {
  ownerUser: null,
  barbearia: null,
  colaboradores: [],
  selectedBarbeiroId: '',
  pendingDeleteBarbeiroId: null,
};

function ownerToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function normalizeTime(timeValue) {
  if (!timeValue) return '';
  return String(timeValue).slice(0, 5);
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function formatDateBR(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = String(isoDate).split('-');
  return `${day}/${month}/${year}`;
}

async function requireOwnerContext() {
  if (!Api.isReady()) {
    ownerToast('Supabase indisponivel.');
    return null;
  }

  const { data } = await Api.client.auth.getSession();
  const session = data?.session || null;
  if (!session?.user?.id) {
    window.location.replace('portal.html');
    return null;
  }

  const ownerRow = await Api.client
    .from('barbearias')
    .select('id,slug,nome,whatsapp')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (ownerRow.error || !ownerRow.data) {
    ownerToast('Acesso restrito ao dono da barbearia.');
    window.setTimeout(() => window.location.replace('portal.html'), 900);
    return null;
  }

  return { ownerUser: session.user, barbearia: ownerRow.data };
}

function setOwnerHeader() {
  const title = document.getElementById('owner-title');
  const subtitle = document.getElementById('owner-subtitle');
  if (!title || !subtitle || !OwnerState.barbearia) return;

  title.textContent = `${OwnerState.barbearia.nome} · Gestao de Acessos`;
  subtitle.textContent = `Slug ativo: ${OwnerState.barbearia.slug} · painel somente leitura da agenda da equipe.`;
}

function updateMetrics() {
  const activeEl = document.getElementById('owner-metric-active');
  const inactiveEl = document.getElementById('owner-metric-inactive');

  const active = OwnerState.colaboradores.filter((item) => item.status === 'ativo').length;
  const inactive = OwnerState.colaboradores.filter((item) => item.status !== 'ativo').length;

  if (activeEl) activeEl.textContent = String(active);
  if (inactiveEl) inactiveEl.textContent = String(inactive);
}

function renderTeamList() {
  const list = document.getElementById('owner-team-list');
  if (!list) return;

  if (!OwnerState.colaboradores.length) {
    list.innerHTML = '<p class="portfolio-empty">Nenhum colaborador cadastrado ainda.</p>';
    return;
  }

  list.innerHTML = OwnerState.colaboradores.map((colab) => {
    const username = String(colab.usuario || '').trim();
    const isActive = colab.status === 'ativo';

    return `
      <article class="team-item team-item-role ${isActive ? 'team-active' : 'team-inactive'}" data-barbeiro-id="${colab.id}">
        <img src="${colab.foto_url || 'https://placehold.co/80x80?text=B'}" alt="Foto de ${colab.nome}">
        <div>
          <div class="team-item-header">
            <strong>${colab.nome}</strong>
            <button type="button" class="team-delete-btn" data-delete-id="${colab.id}" aria-label="Excluir ${colab.nome}" title="Excluir colaborador">&times;</button>
          </div>
          <span>Usuario: ${username || 'nao definido'}</span>
          <span>Status: ${colab.status || 'inativo'}</span>
          <button type="button" class="permission-toggle ${isActive ? 'toggle-on' : 'toggle-off'}" data-status-toggle="${colab.id}" data-next-status="${isActive ? 'inativo' : 'ativo'}">
            ${isActive ? 'Desativar acesso' : 'Ativar acesso'}
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function renderBarberSelector() {
  const select = document.getElementById('owner-agenda-barber');
  if (!select) return;

  const current = OwnerState.selectedBarbeiroId;
  const options = OwnerState.colaboradores.map((colab) => {
    const selected = String(current) === String(colab.id) ? 'selected' : '';
    return `<option value="${colab.id}" ${selected}>${colab.nome} (${colab.status || 'inativo'})</option>`;
  }).join('');

  select.innerHTML = '<option value="">Todos os colaboradores</option>' + options;
}

async function loadTeam() {
  OwnerState.colaboradores = await Api.getBarbersByBarbeariaId(OwnerState.barbearia.id);
  renderTeamList();
  renderBarberSelector();
  updateMetrics();
}

async function loadAgendaReadOnly() {
  const dateInput = document.getElementById('owner-agenda-date');
  const list = document.getElementById('owner-agenda-list');
  const metricAppointments = document.getElementById('owner-metric-appointments');
  if (!dateInput || !list) return;

  const dateISO = dateInput.value || todayISO();
  const selectedBarbeiroId = OwnerState.selectedBarbeiroId || null;

  const rows = await Api.getAppointmentsByDate(OwnerState.barbearia.slug, dateISO, selectedBarbeiroId);
  if (metricAppointments) {
    metricAppointments.textContent = String(rows.filter((item) => item.status !== 'bloqueado').length);
  }

  if (!rows.length) {
    list.innerHTML = '<li class="appt-item"><p class="text-sm text-zinc-400">Nenhum registro para esta data.</p></li>';
    return;
  }

  list.innerHTML = rows.map((row) => {
    const phone = onlyDigits(row.cliente_telefone);
    const rowStatus = row.status || 'pendente';

    return `
      <li class="appt-item">
        <p class="text-sm font-semibold">${normalizeTime(row.horario)} · ${row.cliente_nome}</p>
        <p class="mt-1 text-xs text-zinc-300">${row.servico_nome || 'servico nao informado'} · status: ${rowStatus}</p>
        ${phone && row.status !== 'bloqueado'
          ? `<p class="mt-1 text-xs text-zinc-400">Contato: ${phone}</p>`
          : ''}
      </li>
    `;
  }).join('');
}

function bindOwnerForm() {
  const form = document.getElementById('owner-team-form');
  const nameInput = document.getElementById('owner-team-name');
  const usernameInput = document.getElementById('owner-team-username');
  const passwordInput = document.getElementById('owner-team-password');
  const saveButton = document.getElementById('owner-team-save');

  if (!form || !nameInput || !usernameInput || !passwordInput || !saveButton) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nome = nameInput.value.trim();
    const username = usernameInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    if (!nome || !username || !password) {
      ownerToast('Preencha nome, usuario e senha para cadastrar.');
      return;
    }

    if (password.length < 8) {
      ownerToast('A senha inicial precisa ter no minimo 8 caracteres.');
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Criando acesso...';

    try {
      await Api.createCollaboratorManual({
        barbeariaId: OwnerState.barbearia.id,
        barbeariaSlug: OwnerState.barbearia.slug,
        nome,
        usuario: username,
        senha: password,
      });

      form.reset();
      await loadTeam();
      ownerToast('Colaborador criado com sucesso.');
    } catch (error) {
      console.error('[equipe.js] erro ao criar colaborador:', error);
      ownerToast(error?.message || 'Nao foi possivel criar o colaborador.');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Criar colaborador';
    }
  });
}

function bindTeamActions() {
  const list = document.getElementById('owner-team-list');
  if (!list) return;

  list.addEventListener('click', async (event) => {
    const statusBtn = event.target.closest('[data-status-toggle]');
    if (statusBtn) {
      const barbeiroId = statusBtn.getAttribute('data-status-toggle');
      const nextStatus = statusBtn.getAttribute('data-next-status');
      if (!barbeiroId || !nextStatus) return;

      statusBtn.disabled = true;
      try {
        await Api.updateCollaboratorStatus(barbeiroId, nextStatus);
        await loadTeam();
        ownerToast(`Permissao atualizada para ${nextStatus}.`);
        await loadAgendaReadOnly();
      } catch (error) {
        console.error('[equipe.js] erro ao alterar status:', error);
        ownerToast(error?.message || 'Falha ao alterar permissao do colaborador.');
        statusBtn.disabled = false;
      }
      return;
    }

    const deleteBtn = event.target.closest('[data-delete-id]');
    if (!deleteBtn) return;

    const barbeiroId = deleteBtn.getAttribute('data-delete-id');
    if (!barbeiroId) return;

    confirmarExclusao(barbeiroId);
  });
}

function bindAgendaControls() {
  const dateInput = document.getElementById('owner-agenda-date');
  const barberSelect = document.getElementById('owner-agenda-barber');
  const loadButton = document.getElementById('owner-agenda-load');

  if (!dateInput || !barberSelect || !loadButton) return;

  dateInput.value = todayISO();

  barberSelect.addEventListener('change', async () => {
    OwnerState.selectedBarbeiroId = barberSelect.value || '';
    await loadAgendaReadOnly();
  });

  loadButton.addEventListener('click', async () => {
    OwnerState.selectedBarbeiroId = barberSelect.value || '';
    await loadAgendaReadOnly();
  });
}

function bindRefreshTeamButton() {
  const refreshButton = document.getElementById('owner-refresh-team');
  if (!refreshButton) return;

  refreshButton.addEventListener('click', async () => {
    try {
      refreshButton.disabled = true;
      await loadTeam();
      await loadAgendaReadOnly();
      ownerToast('Equipe atualizada.');
    } catch (error) {
      console.error('[equipe.js] erro ao atualizar equipe:', error);
      ownerToast('Nao foi possivel atualizar a equipe.');
    } finally {
      refreshButton.disabled = false;
    }
  });
}

function openDeleteModal() {
  const modal = document.getElementById('owner-delete-modal');
  if (!modal) return;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  modal.focus();
}

function closeDeleteModal() {
  const modal = document.getElementById('owner-delete-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  OwnerState.pendingDeleteBarbeiroId = null;
}

/**
 * Captura o ID do barbeiro clicado e abre o modal de confirmação.
 * O sistema identifica o colaborador pelo atributo data-delete-id do botão X.
 */
function confirmarExclusao(barbeiroId) {
  const selected = OwnerState.colaboradores.find((item) => String(item.id) === String(barbeiroId));
  if (!selected) {
    ownerToast('Colaborador nao encontrado para exclusao.');
    return;
  }

  OwnerState.pendingDeleteBarbeiroId = selected.id;

  const message = document.getElementById('owner-delete-message');
  if (message) {
    message.textContent = `Deseja realmente remover ${selected.nome} da equipe? Esta ação não pode ser desfeita.`;
  }

  openDeleteModal();
}

async function executarExclusao() {
  const targetId = OwnerState.pendingDeleteBarbeiroId;
  if (!targetId) return;

  const confirmButton = document.getElementById('owner-delete-confirm');
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = 'Excluindo...';
  }

  try {
    // Melhor esforço para revogar acesso antes da exclusao definitiva da linha.
    await Api.updateCollaboratorStatus(targetId, 'inativo').catch(() => null);

    await Api.deleteCollaboratorById(targetId);

    // UX fluida: remove do estado local sem recarregar a página.
    OwnerState.colaboradores = OwnerState.colaboradores.filter((item) => String(item.id) !== String(targetId));

    if (String(OwnerState.selectedBarbeiroId) === String(targetId)) {
      OwnerState.selectedBarbeiroId = '';
    }

    renderTeamList();
    renderBarberSelector();
    updateMetrics();
    await loadAgendaReadOnly();

    closeDeleteModal();
    ownerToast('Colaborador removido da equipe.');
  } catch (error) {
    console.error('[equipe.js] erro ao excluir colaborador:', error);
    ownerToast(error?.message || 'Falha ao excluir colaborador.');
  } finally {
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.textContent = 'SIM, EXCLUIR';
    }
  }
}

function bindDeleteModal() {
  const modal = document.getElementById('owner-delete-modal');
  const closeBtn = document.getElementById('owner-delete-close');
  const cancelBtn = document.getElementById('owner-delete-cancel');
  const confirmBtn = document.getElementById('owner-delete-confirm');

  if (!modal || !closeBtn || !cancelBtn || !confirmBtn) return;

  closeBtn.addEventListener('click', closeDeleteModal);
  cancelBtn.addEventListener('click', closeDeleteModal);
  confirmBtn.addEventListener('click', () => {
    executarExclusao().catch((error) => {
      console.error('[equipe.js] erro em executarExclusao:', error);
      ownerToast('Nao foi possivel concluir a exclusao.');
    });
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeDeleteModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) {
      closeDeleteModal();
    }
  });
}

async function bootstrapOwnerDashboard() {
  const ctx = await requireOwnerContext();
  if (!ctx) return;

  OwnerState.ownerUser = ctx.ownerUser;
  OwnerState.barbearia = ctx.barbearia;

  setOwnerHeader();
  bindOwnerForm();
  bindTeamActions();
  bindAgendaControls();
  bindRefreshTeamButton();
  bindDeleteModal();

  await loadTeam();
  await loadAgendaReadOnly();
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrapOwnerDashboard().catch((error) => {
    console.error('[equipe.js] falha na inicializacao:', error);
    ownerToast('Erro ao carregar o painel do dono.');
  });
});

window.confirmarExclusao = confirmarExclusao;
window.executarExclusao = executarExclusao;
