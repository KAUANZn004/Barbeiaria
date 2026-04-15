/* =========================================================
   api.js
   Responsabilidade: centralizar integração Supabase e CRUD.

  PROCESSO DE DADOS:
  1) Inicializa cliente Supabase uma unica vez.
  2) Busca barbearia por slug para contexto multi-tenant.
  3) Lista servicos ativos para o cliente.
  4) Consulta agendamentos para detectar ocupacao/bloqueio.
  5) Persiste novos agendamentos e bloqueios do dashboard.
  6) Gerencia portfólio (fotos de cortes) e logo da barbearia.
========================================================= */

'use strict';

const SUPABASE_URL = 'https://fhqrrxrkthpnesouwiys.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FtoKh4ddJrPQkDB7rQDzMQ_d3QcOUTw';

const Api = (() => {
  const INTERNAL_AUTH_DOMAIN = 'barbearia.local';

  /** Cliente Supabase compartilhado entre todas as páginas. */
  const client = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  /** Verifica se o cliente Supabase foi criado corretamente. */
  function isReady() {
    return Boolean(client);
  }

  /** Busca dados da barbearia por slug para montar cabeçalhos das páginas. */
  async function getBarbershopBySlug(slug) {
    if (!isReady()) return null;
    const { data, error } = await client.from('barbearias').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Lista serviços ativos para o fluxo de agendamento do cliente.
   * Processo: esta funcao abastece os cards clicaveis do index.html.
   */
  async function getServicesBySlug(slug) {
    if (!isReady()) return [];
    const { data, error } = await client
      .from('servicos')
      .select('id,nome,preco,duracao,ativo')
      .eq('barbearia_slug', slug)
      .eq('ativo', true)
      .order('preco', { ascending: true });
    if (error) throw error;
    return data ? data : [];
  }

  /** Retorna reservas e bloqueios do dia para calcular horários ocupados.
   * Processo: a mesma fonte atende cliente (desabilita slots) e
   * dashboard (detectar conflitos antes de bloquear).
   */
  async function getAppointmentsByDate(slug, date, barbeiroId) {
    if (!isReady()) return [];
    let query = client
      .from('agendamentos')
      .select('id,data,horario,status,cliente_nome,cliente_telefone,servico_nome,barbeiro_id')
      .eq('barbearia_slug', slug)
      .eq('data', date)
      .neq('status', 'cancelado')
      .order('horario', { ascending: true });

    /*
      Quando o cliente escolhe um barbeiro, a agenda deve mostrar
      apenas os horários daquele profissional.
      O filtro abaixo aplica exatamente a regra solicitada:
      .eq('barbeiro_id', selecionado)
    */
    if (barbeiroId) {
      query = query.eq('barbeiro_id', barbeiroId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ? data : [];
  }

  /** Cria um novo agendamento para o cliente.
   * Processo: etapa final da jornada de reserva no index.html.
   */
  async function createAppointment(payload) {
    if (!isReady()) throw new Error('Supabase indisponivel.');
    const { data, error } = await client.from('agendamentos').insert([payload]).select().single();
    if (error) throw error;
    return data;
  }

  /** Cria bloqueio manual da agenda pelo barbeiro.
   * Processo: usado somente quando nao existe reserva no horario.
   */
  async function createBlockedSlot(payload) {
    if (!isReady()) throw new Error('Supabase indisponivel.');
    const { data, error } = await client.from('agendamentos').insert([payload]).select().single();
    if (error) throw error;
    return data;
  }

  /** Remove bloqueio manual pelo id do registro. */
  async function deleteBlockedSlot(blockedId) {
    if (!isReady()) throw new Error('Supabase indisponivel.');
    const { error } = await client
      .from('agendamentos')
      .delete()
      .eq('id', blockedId)
      .eq('status', 'bloqueado');

    if (error) throw error;
    return true;
  }

  /**
   * Cancela um agendamento real atualizando o status para 'cancelado'.
   * Usado no painel do colaborador ao optar por "cancelar e bloquear" após conflito.
   * A guarda .neq('status','bloqueado') protege registros de bloqueio de alteração acidental.
   */
  async function cancelAppointment(appointmentId) {
    if (!isReady()) throw new Error('Supabase indisponivel.');
    const { data, error } = await client
      .from('agendamentos')
      .update({ status: 'cancelado' })
      .eq('id', appointmentId)
      .neq('status', 'bloqueado')
      .select('id')
      .single();
    if (error) throw error;
    return data;
  }

  /** Lista bloqueios futuros para exibição no dashboard.
   * Processo: alimenta visual de controle da agenda do barbeiro.
   */
  async function getBlockedSlots(slug, startDate, barbeiroId) {
    if (!isReady()) return [];
    let query = client
      .from('agendamentos')
      .select('id,data,horario,status,barbeiro_id')
      .eq('barbearia_slug', slug)
      .eq('status', 'bloqueado')
      .gte('data', startDate)
      .order('data', { ascending: true })
      .order('horario', { ascending: true });

    /*
      No dashboard, também podemos ler bloqueios por barbeiro
      para manter consistência com o filtro de agenda individual.
    */
    if (barbeiroId) {
      query = query.eq('barbeiro_id', barbeiroId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ? data : [];
  }

  /**
   * Lista equipe de barbeiros da unidade (barbearia).
   * Cada barbeiro pertence a uma barbearia_id e possui id único.
   */
  async function getBarbersByBarbeariaId(barbeariaId) {
    if (!isReady()) return [];
    const { data, error } = await client
      .from('barbeiros')
      .select('*')
      .eq('barbearia_id', barbeariaId)
      .order('nome', { ascending: true });
    if (error) throw error;
    return data ? data : [];
  }

  /**
   * Login manual do colaborador diretamente na tabela barbeiros.
   * Ignora auth.users por decisão arquitetural do projeto.
   */
  async function getCollaboratorByCredentials(usuario, senha) {
    if (!isReady()) throw new Error('Supabase indisponivel.');

    const normalizedUsuario = String(usuario || '').trim().toLowerCase();
    const normalizedSenha = String(senha || '').trim();
    if (!normalizedUsuario || !normalizedSenha) {
      return null;
    }

    const { data, error } = await client
      .from('barbeiros')
      .select('*')
      .eq('usuario', normalizedUsuario)
      .eq('senha', normalizedSenha)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  /** Busca colaborador pelo ID para validar sessão manual no dashboard-colaborador. */
  async function getCollaboratorById(barbeiroId) {
    if (!isReady()) return null;
    const { data, error } = await client
      .from('barbeiros')
      .select('id,nome,usuario,foto_url,servicos,servicos_json,preco_base,status,barbearia_id,barbearia_slug')
      .eq('id', barbeiroId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  /**
   * Busca o colaborador pelo user_id autenticado.
   * Usado no dashboard-colaborador para carregar perfil e contexto da unidade.
   */
  async function getBarberByUserId(userId) {
    if (!isReady()) return null;
    const { data, error } = await client
      .from('barbeiros')
      .select('id,nome,email,foto_url,servicos,preco_base,status,barbearia_id,barbearia_slug,user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  /**
   * Atualiza perfil do colaborador logado.
   */
  async function updateBarberProfile(barbeiroId, { fotoUrl, servicos, precoBase }) {
    if (!isReady()) throw new Error('Supabase indisponivel.');
    const normalizedServices = Array.isArray(servicos) ? servicos : [];
    const payload = {
      foto_url: fotoUrl || null,
      servicos: normalizedServices.length ? normalizedServices.map((item) => item.nome).join(', ') : null,
      servicos_json: normalizedServices,
      preco_base: Number.isFinite(precoBase) ? Number(precoBase) : null,
    };

    const { data, error } = await client
      .from('barbeiros')
      .update(payload)
      .eq('id', barbeiroId)
      .select('id,nome,usuario,email,foto_url,servicos,servicos_json,preco_base,status,barbearia_id,barbearia_slug,user_id')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Lista próximos atendimentos de um colaborador.
   */
  async function getUpcomingAppointmentsByBarber(barbeariaSlug, barbeiroId, startDate, limit) {
    if (!isReady()) return [];

    const { data, error } = await client
      .from('agendamentos')
      .select('id,data,horario,status,cliente_nome,cliente_telefone,servico_nome,barbeiro_id')
      .eq('barbearia_slug', barbeariaSlug)
      .eq('barbeiro_id', barbeiroId)
      .gte('data', startDate)
      .neq('status', 'cancelado')
      .order('data', { ascending: true })
      .order('horario', { ascending: true })
      .limit(Number(limit) || 30);

    if (error) throw error;
    return data ? data : [];
  }

  /**
   * Cria conta de colaborador com cliente isolado para nao sobrescrever
   * a sessao atual do dono no navegador.
   */
  async function createCollaboratorAccount(email, password) {
    if (!window.supabase) throw new Error('SDK Supabase indisponivel.');

    const isolatedClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await isolatedClient.auth.signUp({ email, password });
    if (error) throw error;

    const userId = data?.user?.id || null;
    if (!userId) {
      throw new Error('Nao foi possivel criar o usuario de acesso do colaborador.');
    }

    return { userId, needsEmailConfirmation: !data?.session };
  }

  /**
   * Converte nome de usuário em e-mail interno para Auth.
   * Exemplo: "jota.barber" -> "jota.barber@barbearia.local"
   */
  function toInternalEmailFromUsername(username) {
    const normalized = String(username || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');

    if (!normalized) {
      throw new Error('Nome de usuario invalido para criar acesso interno.');
    }

    return `${normalized}@${INTERNAL_AUTH_DOMAIN}`;
  }

  /**
   * Fluxo unificado do dono para cadastrar colaborador:
   * 1) cria conta de acesso (Auth)
   * 2) vincula colaborador na tabela barbeiros
   */
  async function createCollaboratorWithAccount({
    barbeariaId,
    barbeariaSlug,
    nome,
    username,
    password,
    fotoUrl,
    servicos,
    precoBase,
    status,
  }) {
    if (!isReady()) throw new Error('Supabase indisponivel.');

    const normalizedUsername = String(username || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');
    const normalizedEmail = toInternalEmailFromUsername(normalizedUsername);
    const normalizedName = String(nome || '').trim();

    if (!normalizedName || !normalizedUsername || !password) {
      throw new Error('Nome, usuario e senha sao obrigatorios.');
    }

    const { userId, needsEmailConfirmation } = await createCollaboratorAccount(normalizedEmail, password);

    const payload = {
      barbearia_id: barbeariaId,
      barbearia_slug: barbeariaSlug,
      user_id: userId,
      nome: normalizedName,
      email: normalizedEmail,
      foto_url: fotoUrl || null,
      servicos: servicos || null,
      preco_base: Number.isFinite(precoBase) ? Number(precoBase) : null,
      status: status || 'ativo',
    };

    const { data, error } = await client
      .from('barbeiros')
      .insert([payload])
      .select('id,nome,email,foto_url,servicos,preco_base,status,barbearia_id,barbearia_slug,user_id')
      .single();

    if (error) {
      const isDuplicate = error.code === '23505' || String(error.message || '').toLowerCase().includes('duplicate');
      if (isDuplicate) {
        throw new Error('Ja existe colaborador com este nome de usuario nesta equipe.');
      }
      throw error;
    }

    return { colaborador: data, needsEmailConfirmation, internalEmail: normalizedEmail };
  }

  /**
   * Cadastro manual de colaborador (sem auth.users), usando apenas
   * nome + usuario + senha + barbearia_id.
   */
  async function createCollaboratorManual({ barbeariaId, barbeariaSlug, nome, usuario, senha }) {
    if (!isReady()) throw new Error('Supabase indisponivel.');

    const normalizedNome = String(nome || '').trim();
    const normalizedUsuario = String(usuario || '').trim().toLowerCase();
    const normalizedSenha = String(senha || '').trim();

    if (!normalizedNome || !normalizedUsuario || !normalizedSenha) {
      throw new Error('Nome, usuario e senha sao obrigatorios.');
    }

    const payload = {
      barbearia_id: barbeariaId,
      barbearia_slug: barbeariaSlug,
      nome: normalizedNome,
      usuario: normalizedUsuario,
      senha: normalizedSenha,
      status: 'ativo',
    };

    const { data, error } = await client
      .from('barbeiros')
      .insert([payload])
      .select('*')
      .single();

    if (error) {
      const isDuplicate = error.code === '23505' || String(error.message || '').toLowerCase().includes('duplicate');
      if (isDuplicate) {
        throw new Error('Ja existe colaborador com este usuario nesta barbearia.');
      }
      throw error;
    }

    return data;
  }

  /** Ativa ou inativa colaborador para controle de permissões. */
  async function updateCollaboratorStatus(barbeiroId, status) {
    if (!isReady()) throw new Error('Supabase indisponivel.');

    const allowed = ['ativo', 'inativo', 'pendente'];
    if (!allowed.includes(status)) {
      throw new Error('Status invalido para colaborador.');
    }

    const { data, error } = await client
      .from('barbeiros')
      .update({ status })
      .eq('id', barbeiroId)
      .select('id,nome,email,status,barbearia_id,barbearia_slug,user_id')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Remove colaborador da equipe pelo id.
   * Observacao: a conta em auth.users nao pode ser removida via client-side anon.
   * O recomendado e usar Edge Function com service role para revogar acesso total.
   */
  async function deleteCollaboratorById(barbeiroId) {
    if (!isReady()) throw new Error('Supabase indisponivel.');

    const { error } = await client
      .from('barbeiros')
      .delete()
      .eq('id', barbeiroId);

    if (error) throw error;
    return true;
  }

  /**
   * Cadastra barbeiro na equipe da barbearia.
   * Usado no dashboard para adicionar colaboradores.
   */
  async function addBarberToTeam({ barbeariaId, barbeariaSlug, nome, fotoUrl, userId, status }) {
    if (!isReady()) throw new Error('Supabase indisponivel.');

    const fullPayload = {
      barbearia_id: barbeariaId,
      barbearia_slug: barbeariaSlug,
      nome,
      foto_url: fotoUrl || null,
      user_id: userId || null,
      status: status || 'ativo',
    };

    // Alguns bancos podem não ter todas as colunas opcionais.
    // Tenta payload completo e faz fallback para payloads mínimos.
    const payloadVariants = [
      fullPayload,
      {
        barbearia_id: barbeariaId,
        barbearia_slug: barbeariaSlug,
        nome,
        user_id: userId || null,
        status: status || 'ativo',
      },
      {
        barbearia_id: barbeariaId,
        barbearia_slug: barbeariaSlug,
        nome,
        user_id: userId || null,
      },
      {
        barbearia_slug: barbeariaSlug,
        nome,
        user_id: userId || null,
      },
      {
        barbearia_slug: barbeariaSlug,
        nome,
      },
    ];

    let lastError = null;

    for (const payload of payloadVariants) {
      const { data, error } = await client
        .from('barbeiros')
        .insert([payload])
        .select()
        .single();

      if (!error) {
        return data;
      }

      lastError = error;
      const msg = String(error.message || '').toLowerCase();
      const isMissingColumn = error.code === '42703' || msg.includes('column') && msg.includes('does not exist');

      // Se for erro de coluna inexistente, tenta o próximo payload.
      if (isMissingColumn) {
        continue;
      }

      // Para outros erros (ex: RLS), interrompe e retorna erro explícito.
      break;
    }

    if (lastError) {
      const msg = String(lastError.message || '').toLowerCase();
      const isRls = lastError.code === '42501' || msg.includes('row-level security') || msg.includes('permission denied');

      if (isRls) {
        throw new Error('Permissao negada para inserir colaborador. Verifique a policy de INSERT da tabela barbeiros.');
      }

      throw new Error(lastError.message || 'Falha ao cadastrar colaborador na equipe.');
    }

    throw new Error('Falha ao cadastrar colaborador na equipe.');
  }

  /**
   * Busca barbearias por nome ou slug para fluxo de colaborador no portal.
   */
  async function searchBarbershops(term) {
    if (!isReady()) return [];
    const safeTerm = String(term || '').trim();
    if (!safeTerm) return [];

    const { data, error } = await client
      .from('barbearias')
      .select('id,nome,slug,whatsapp')
      .or(`nome.ilike.%${safeTerm}%,slug.ilike.%${safeTerm}%`)
      .order('nome', { ascending: true })
      .limit(8);
    if (error) throw error;
    return data ? data : [];
  }

  /* ─────────────────────────────────────────────────────
     PORTFÓLIO E LOGO

     TABLE: portfolio
       id            — PK gerado pelo banco
       barbearia_id  — FK para barbearias.id
       image_url     — URL pública do Supabase Storage
       descricao     — texto livre sobre o corte

     TABLE: barbearias
       logo_url      — URL pública do logo (coluna adicionada)

     FLUXO DO UPLOAD (combinado com storage.js):
       1) storage.js faz upload → retorna URL pública
       2) api.js salva essa URL no banco
       3) Frontend usa a URL armazenada para renderizar <img>
  ───────────────────────────────────────────────────── */

  /**
   * Lista as fotos do portfólio de uma barbearia.
   * Usado na página do cliente para exibir os trabalhos.
   *
   * @param {string|number} barbeariaId — id da linha em `barbearias`
   * @returns {Promise<Array<{ id, image_url, descricao }>>}
   */
  async function getPortfolioByBarbearia(barbeariaId) {
    if (!isReady()) return [];
    const { data, error } = await client
      .from('portfolio')
      .select('id,image_url,descricao')
      .eq('barbearia_id', barbeariaId)
      .order('id', { ascending: false });
    if (error) throw error;
    return data ? data : [];
  }

  /**
   * Insere uma nova foto no portfólio da barbearia.
   *
   * PROCESSO:
   *   1) storage.js já fez o upload e gerou a URL pública
   *   2) Esta função salva { barbearia_id, image_url, descricao }
   *      na tabela `portfolio`
   *   3) A URL agora está persistida e disponível para o cliente
   *
   * @param {{ barbeariaId: string|number, imageUrl: string, descricao: string }} payload
   * @returns {Promise<Object>} row inserida
   */
  async function addPortfolioItem({ barbeariaId, imageUrl, descricao }) {
    if (!isReady()) throw new Error('Supabase indisponível.');
    const { data, error } = await client
      .from('portfolio')
      .insert([{ barbearia_id: barbeariaId, image_url: imageUrl, descricao }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Atualiza a coluna `logo_url` na tabela `barbearias`.
   *
   * PROCESSO:
   *   1) storage.js fez upload do logo e gerou URL pública
   *   2) Esta função persiste a URL na linha da barbearia
   *   3) O header do dashboard e do cliente poderá exibir o logo
   *
   * @param {string} barbeariaId — id da linha em `barbearias`
   * @param {string} logoUrl     — URL pública gerada pelo Storage
   * @returns {Promise<Object>} row atualizada
   */
  async function updateBarbeariaLogo(barbeariaId, logoUrl) {
    if (!isReady()) throw new Error('Supabase indisponível.');
    const { data, error } = await client
      .from('barbearias')
      .update({ logo_url: logoUrl })
      .eq('id', barbeariaId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  return {
    client,
    isReady,
    getBarbershopBySlug,
    getServicesBySlug,
    getAppointmentsByDate,
    createAppointment,
    createBlockedSlot,
    deleteBlockedSlot,
    cancelAppointment,
    getBlockedSlots,
    getBarbersByBarbeariaId,
    getCollaboratorByCredentials,
    getCollaboratorById,
    getBarberByUserId,
    updateBarberProfile,
    getUpcomingAppointmentsByBarber,
    addBarberToTeam,
    createCollaboratorWithAccount,
    createCollaboratorManual,
    updateCollaboratorStatus,
    deleteCollaboratorById,
    searchBarbershops,
    getPortfolioByBarbearia,
    addPortfolioItem,
    updateBarbeariaLogo,
  };
})();

window.Api = Api;
