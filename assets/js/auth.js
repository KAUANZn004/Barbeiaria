/* ====================================================
   AUTH.JS — BarberSaaS
   Arquivo: assets/js/auth.js

   RESPONSABILIDADE:
     1) Controle dos modais de autenticação do portal.html
     2) Operações de login e cadastro via Supabase Auth
     3) Verificação de papel (dono / barbeiro / cliente)
    4) Guard de rota para páginas restritas (dashboards por papel)

   FLUXO COMPLETO:
     [Sou Barbeiro] → Modal Escolha (Tela 1)
       ├── [Login]     → Tela 2: e-mail/usuario + senha
       │     └── signInWithPassword → checkRole → dashboard-dono.html?b=<slug>
       └── [Cadastrar] → Tela 3: form completo
             └── signUp → INSERT barbearias → dashboard-dono.html?b=<slug>
     [Quero Agendar] → Modal slug → index.html?b=<slug>

   DEPENDÊNCIAS:
     - Supabase JS v2 carregado antes (window.supabase)
     - api.js carregado antes (expõe window.Api com Api.client)

   MULTI-TENANCY — como os papéis funcionam:
     Cada usuário do Supabase Auth pode ser:
       'dono'     → tem registro em `barbearias.user_id`
       'barbeiro' → tem registro em `barbeiros.user_id`
       'cliente'  → nenhum dos dois (conta pública)
   ==================================================== */

'use strict';

/* ─────────────────────────────────────────────────────
   AUTHSERVICE — operações Supabase Auth

   Usa Api.client para não duplicar a criação do cliente.
   Toda comunicação com o Supabase Auth passa por aqui.
───────────────────────────────────────────────────── */
const AuthService = {

  /** Retorna a sessão ativa ou null se não autenticado. */
  async getSession() {
    const { data } = await Api.client.auth.getSession();
    return data?.session ?? null;
  },

  /**
   * Login com e-mail real (dono) ou usuario interno (colaborador).
   * O usuario informado e convertido para e-mail interno quando necessario.
   * @returns {{ user: User|null, error: Error|null }}
   */
  async signIn(loginOrEmail, password) {
    const normalizedEmail = window.Permissoes
      ? window.Permissoes.loginToAuthEmail(loginOrEmail)
      : String(loginOrEmail || '').trim().toLowerCase();

    const { data, error } = await Api.client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    return { user: data?.user ?? null, error };
  },

  /**
   * Login manual do colaborador (usuario + senha) sem usar Auth do Supabase.
   * Este método ignora o sistema padrão de e-mail para simplificar a
   * gestão da equipe em uma arquitetura controlada pela tabela `barbeiros`.
   */
  async loginManual(usuario, senha) {
    try {
      const colaborador = await Api.getCollaboratorByCredentials(usuario, senha);
      if (!colaborador) {
        return { colaborador: null, error: new Error('Usuario ou senha invalidos.') };
      }

      if (colaborador.status && colaborador.status !== 'ativo') {
        return { colaborador: null, error: new Error('Seu acesso esta inativo. Fale com o dono da barbearia.') };
      }

      return { colaborador, error: null };
    } catch (error) {
      return { colaborador: null, error };
    }
  },

  /**
   * Cadastro de novo usuário no Supabase Auth.
   * Não insere em `barbearias` — isso é feito separadamente
   * em createBarbearia() após confirmar o signUp.
   * @returns {{ user: User|null, session: Session|null, error: Error|null }}
   */
  async signUp(email, password) {
    const { data, error } = await Api.client.auth.signUp({ email, password });
    return { user: data?.user ?? null, session: data?.session ?? null, error };
  },

  /**
   * Insere linha na tabela `barbearias` vinculando o user_id.
   * Chamado imediatamente após signUp bem-sucedido.
   *
   * PROCESSO:
   *   1) signUp retorna user.id
   *   2) Este método une auth ao modelo de negócio
   *   3) Row Level Security do Supabase usa o user_id aqui inserido
   *
   * @param {{ nome, slug, whatsapp, userId }} payload
   * @returns {{ data, error }}
   */
  async createBarbearia({ nome, slug, whatsapp, userId }) {
    const { data, error } = await Api.client
      .from('barbearias')
      .insert([{ nome, slug, whatsapp, user_id: userId }])
      .select()
      .single();
    return { data, error };
  },

  /**
   * Descobre o papel do usuário autenticado.
   *
   * HIERARQUIA MULTI-TENANCY:
   *   1. Consulta `barbearias` WHERE user_id = userId  → papel = 'dono'
   *   2. Consulta `barbeiros`  WHERE user_id = userId  → papel = 'barbeiro'
   *   3. Nenhum dos dois                               → papel = 'cliente'
   *
   * @param   {string} userId — UUID do Supabase Auth
   * @returns {{ isBarbeiro, role, barbearia, barbeiro }}
   */
  async checkRole(userId) {
    // Passo 1 — verifica se é dono de uma barbearia
    const { data: barbearia } = await Api.client
      .from('barbearias')
      .select('id, slug, nome, whatsapp')
      .eq('user_id', userId)
      .maybeSingle();

    if (barbearia) {
      return { isBarbeiro: true, role: 'dono', barbearia, barbeiro: null };
    }

    // Passo 2 — verifica se é barbeiro individual
    const { data: barbeiro } = await Api.client
      .from('barbeiros')
      .select('id, nome, status, barbearia_slug')
      .eq('user_id', userId)
      .maybeSingle();

    if (barbeiro) {
      if (barbeiro.status && barbeiro.status !== 'ativo') {
        return { isBarbeiro: false, role: 'cliente', barbearia: null, barbeiro };
      }

      const { data: barb } = await Api.client
        .from('barbearias')
        .select('id, slug, nome, whatsapp')
        .eq('slug', barbeiro.barbearia_slug)
        .maybeSingle();
      return { isBarbeiro: true, role: 'barbeiro', barbearia: barb, barbeiro };
    }

    // Passo 3 — usuário sem papel de barbeiro
    return { isBarbeiro: false, role: 'cliente', barbearia: null, barbeiro: null };
  },

  /** Encerra sessão e redireciona ao portal. */
  async signOut() {
    await Api.client.auth.signOut();
    window.location.replace('portal.html');
  },

  /**
  * Guard de rota para páginas restritas (dashboard por papel).
   * Deve ser chamado no início de qualquer página que
   * exige autenticação de barbeiro.
   *
   * CONTROLE DE ACESSO:
   *   1. Sem sessão       → redireciona para portal.html
   *   2. Sem papel barb.  → redireciona para index.html
   *   3. OK               → retorna contexto completo
   *
   * @returns {{ user, barbearia, role, barbeiro }|null}
   */
  async requireBarbeiro() {
    const session = await this.getSession();
    if (!session) {
      window.location.replace('portal.html');
      return null;
    }
    const ctx = await this.checkRole(session.user.id);
    if (!ctx.isBarbeiro) {
      window.location.replace('index.html');
      return null;
    }
    return { user: session.user, ...ctx };
  },
};

/* ─────────────────────────────────────────────────────
   CONTROLE DOS MODAIS

   Dois overlays independentes:
     - #modal-overlay  → barbeiro (3 telas internas)
     - #modal-cliente  → cliente (1 tela com slug input)

   openModal(el)    → adiciona '.is-open' → CSS faz fade-in
   closeModal(el)   → remove '.is-open'  → CSS faz fade-out
   showScreen(name) → alterna telas via atributo `hidden`
───────────────────────────────────────────────────── */

/**
 * Abre o modal adicionando '.is-open'.
 * O CSS cuida da transição opacity + transform da modal-box.
 */
function openModal(overlayEl) {
  overlayEl.classList.add('is-open');
  overlayEl.setAttribute('aria-hidden', 'false');
  overlayEl.focus(); // foco acessível para leitores de tela
}

/** Fecha o modal removendo '.is-open'. */
function closeModal(overlayEl) {
  overlayEl.classList.remove('is-open');
  overlayEl.setAttribute('aria-hidden', 'true');
}

/**
 * Alterna entre as telas internas do modal do barbeiro.
 *
 * TRANSIÇÃO:
 *   - `hidden` some com a tela anterior instantaneamente
 *   - A nova tela dispara a animação CSS `screenFadeIn`
 *   - Isso cria o efeito de fade sem JS adicional
 *
 * @param {'choose'|'login'|'register'} name
 */
function showScreen(name) {
  document.getElementById('modal-choose').hidden   = name !== 'choose';
  document.getElementById('modal-login').hidden    = name !== 'login';
  document.getElementById('modal-register').hidden = name !== 'register';
  const collab = document.getElementById('modal-collab');
  if (collab) collab.hidden = name !== 'collab';
}

/* ─────────────────────────────────────────────────────
   UTILITÁRIOS DE UI
───────────────────────────────────────────────────── */

/** Exibe mensagem de erro no elemento aria-live do formulário. */
function showFormError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

/** Limpa a mensagem de erro. */
function clearFormError(el) {
  el.textContent = '';
  el.hidden = true;
}

/**
 * Coloca um botão em estado de loading.
 * Restaura o texto original via data-label ao finalizar.
 */
function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Aguarde...' : (btn.dataset.label ?? btn.textContent);
}

/* ─────────────────────────────────────────────────────
   BOOTSTRAP DOS EVENTOS
   Registra todos os listeners após o DOM estar pronto.
───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  // auth.js pode ser carregado em outras paginas; nesse caso
  // so exportamos AuthService e encerramos sem bind de modal.
  if (!document.getElementById('btn-barbeiro')) {
    return;
  }

  const overlayEl      = document.getElementById('modal-overlay');
  const overlayCliente = document.getElementById('modal-cliente');

  /* —— Abrir modais —————————————————————————————— */

  // "Sou Barbeiro" → modal de escolha (sempre começa na Tela 1)
  document.getElementById('btn-barbeiro').addEventListener('click', () => {
    showScreen('choose');
    openModal(overlayEl);
  });

  // "Quero Agendar" → modal de slug do cliente
  document.getElementById('btn-cliente').addEventListener('click', () => {
    openModal(overlayCliente);
  });

  /* —— Fechar modais (botão ×) ——————————————————— */
  document.getElementById('close-modal-choose').addEventListener('click',   () => closeModal(overlayEl));
  document.getElementById('close-modal-login').addEventListener('click',    () => closeModal(overlayEl));
  document.getElementById('close-modal-register').addEventListener('click', () => closeModal(overlayEl));
  document.getElementById('close-modal-collab').addEventListener('click', () => closeModal(overlayEl));
  document.getElementById('close-modal-cliente').addEventListener('click',  () => closeModal(overlayCliente));

  /* —— Fechar ao clicar fora da modal-box ———————— */
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeModal(overlayEl);
  });
  overlayCliente.addEventListener('click', (e) => {
    if (e.target === overlayCliente) closeModal(overlayCliente);
  });

  /* —— Fechar com ESC ———————————————————————————— */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeModal(overlayEl);
    closeModal(overlayCliente);
  });

  /* —— Navegação entre telas do modal do barbeiro — */
  // Tela 1 → Tela 2
  document.getElementById('go-login').addEventListener('click', () => showScreen('login'));
  // Tela 1 → Tela 3
  document.getElementById('go-register').addEventListener('click', () => showScreen('register'));
  // Tela 1 → Tela 4
  document.getElementById('go-collab').addEventListener('click', () => showScreen('collab'));
  // Tela 2 → Tela 1
  document.getElementById('back-from-login').addEventListener('click', () => showScreen('choose'));
  // Tela 3 → Tela 1
  document.getElementById('back-from-register').addEventListener('click', () => showScreen('choose'));
  // Tela 4 → Tela 1
  document.getElementById('back-from-collab').addEventListener('click', () => showScreen('choose'));

  /* —— Preview do slug conforme digita ————————————
     Normaliza para lowercase+hífens e pré-visualiza
     na linha "URL: ?b=<slug>" abaixo do campo.
  ————————————————————————————————————————————————— */
  document.getElementById('reg-slug').addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    e.target.value = val;
    document.getElementById('slug-preview').textContent = val || 'seu-slug';
  });

  /* ══════════════════════════════════════════════════
     SUBMIT: LOGIN
     1) Valida campos no client
     2) signInWithPassword → autentica
     3) checkRole → encontra barbearia vinculada
     4) Persiste slug no localStorage
      5) Redireciona por papel: dono/collab
  ══════════════════════════════════════════════════ */
  const loginErrorEl   = document.getElementById('login-error');
  const btnLoginSubmit = document.getElementById('btn-login-submit');

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(loginErrorEl);

    const loginInput = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!loginInput || !password) {
      showFormError(loginErrorEl, 'Preencha usuario/e-mail e senha.');
      return;
    }

    setLoading(btnLoginSubmit, true);

    try {
      // Passo 1 — autenticar
      const { user, error } = await AuthService.signIn(loginInput, password);
      if (error || !user) {
        showFormError(loginErrorEl, error?.message ?? 'Usuario/e-mail ou senha invalidos.');
        return;
      }

      // Passo 2 — identificar barbearia do usuário
      let ctx = await AuthService.checkRole(user.id);

      // Fluxo opcao 2: se o cadastro foi feito sem sessão (email confirmation),
      // finalizamos a criação da barbearia no primeiro login confirmado.
      if (!ctx.isBarbeiro || !ctx.barbearia?.slug) {
        const pendingRaw = localStorage.getItem('barbersaas.pendingBarbearia');
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw);
            const loginEmail = window.Permissoes
              ? window.Permissoes.loginToAuthEmail(loginInput)
              : String(loginInput || '').trim().toLowerCase();
            const pendingEmail = String(pending?.email || '').trim().toLowerCase();

            if (pending?.nome && pending?.slug && pending?.whatsapp && pendingEmail === loginEmail) {
              const { error: createError } = await AuthService.createBarbearia({
                nome: pending.nome,
                slug: pending.slug,
                whatsapp: pending.whatsapp,
                userId: user.id,
              });

              if (createError) {
                const slugTaken = createError.code === '23505' || createError.message?.includes('unique');
                showFormError(
                  loginErrorEl,
                  slugTaken
                    ? 'Sua conta foi confirmada, mas o slug escolhido já está em uso. Cadastre novamente com outro slug.'
                    : createError.message,
                );
                return;
              }

              localStorage.removeItem('barbersaas.pendingBarbearia');
              ctx = await AuthService.checkRole(user.id);
            }
          } catch (parseErr) {
            console.error('[Auth] pendingBarbearia parse error:', parseErr);
          }
        }

        if (!ctx.isBarbeiro || !ctx.barbearia?.slug) {
          showFormError(loginErrorEl, 'Nenhuma barbearia vinculada a esta conta.');
          return;
        }
      }

      // Passo 3 — salvar slug e redirecionar conforme papel RBAC
      localStorage.setItem('barbersaas.slug', ctx.barbearia.slug);
      if (ctx.role === 'dono') {
        window.location.href = `dashboard-dono.html?b=${ctx.barbearia.slug}`;
      } else {
        window.location.href = `dashboard-colaborador.html?b=${ctx.barbearia.slug}`;
      }

    } catch (err) {
      showFormError(loginErrorEl, 'Erro inesperado. Tente novamente.');
      console.error('[Auth] signIn error:', err);
    } finally {
      setLoading(btnLoginSubmit, false);
    }
  });

  /* ══════════════════════════════════════════════════
     SUBMIT: CADASTRO
     1) Valida todos os campos no client
     2) signUp → cria usuário no Supabase Auth
     3) INSERT em `barbearias` com o user_id recebido
        (slug duplicado → erro de unique constraint)
     4) Persiste slug no localStorage
      5) Redireciona → dashboard-dono.html?b=<slug>
  ══════════════════════════════════════════════════ */
  const registerErrorEl   = document.getElementById('register-error');
  const btnRegisterSubmit = document.getElementById('btn-register-submit');

  document.getElementById('form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(registerErrorEl);

    const nome     = document.getElementById('reg-nome').value.trim();
    const slug     = document.getElementById('reg-slug').value.trim().toLowerCase();
    const whatsapp = document.getElementById('reg-whatsapp').value.replace(/\D/g, '');
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    // Validações client-side antes de chamar a API
    if (!nome || !slug || !whatsapp || !email || !password) {
      showFormError(registerErrorEl, 'Preencha todos os campos.');
      return;
    }
    if (password.length < 8) {
      showFormError(registerErrorEl, 'A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      showFormError(registerErrorEl, 'Slug: apenas letras minúsculas, números e hífens.');
      return;
    }

    setLoading(btnRegisterSubmit, true);

    try {
      // Passo 1 — criar usuário no Supabase Auth
      const { user, session, error: signUpError } = await AuthService.signUp(email, password);
      if (signUpError || !user) {
        showFormError(registerErrorEl, signUpError?.message ?? 'Erro ao criar conta.');
        return;
      }

      // Se não houver sessão ativa após signUp, o projeto está exigindo
      // confirmação de e-mail. Nesse caso não podemos inserir em barbearias
      // agora (RLS depende de auth.uid), então salvamos pendência para concluir
      // no primeiro login confirmado.
      if (!session) {
        localStorage.setItem('barbersaas.pendingBarbearia', JSON.stringify({
          nome,
          slug,
          whatsapp,
          email: email.toLowerCase(),
        }));

        showFormError(
          registerErrorEl,
          'Conta criada. Confirme seu e-mail e faça login para concluir o cadastro da barbearia.',
        );

        showScreen('login');
        const loginEmailInput = document.getElementById('login-email');
        if (loginEmailInput) loginEmailInput.value = email;
        return;
      }

      // Passo 2 — com sessão ativa, vincula barbearia ao user_id recém-criado
      const { error: barbError } = await AuthService.createBarbearia({
        nome, slug, whatsapp, userId: user.id,
      });

      if (barbError) {
        // Erro de unique constraint = slug já em uso
        const slugTaken = barbError.code === '23505' || barbError.message?.includes('unique');
        showFormError(
          registerErrorEl,
          slugTaken ? 'Este slug já está em uso. Escolha outro.' : barbError.message,
        );
        return;
      }

      // Passo 3 — salvar slug e redirecionar
      localStorage.setItem('barbersaas.slug', slug);
      window.location.href = `dashboard-dono.html?b=${slug}`;

    } catch (err) {
      showFormError(registerErrorEl, 'Erro inesperado. Tente novamente.');
      console.error('[Auth] signUp error:', err);
    } finally {
      setLoading(btnRegisterSubmit, false);
    }
  });

  /* ══════════════════════════════════════════════════
     SUBMIT: MODAL DO CLIENTE
     Valida slug, persiste no localStorage e redireciona
     para o fluxo de agendamento.
  ══════════════════════════════════════════════════ */
  const clienteErrorEl = document.getElementById('cliente-error');

  document.getElementById('form-cliente').addEventListener('submit', (e) => {
    e.preventDefault();
    clearFormError(clienteErrorEl);

    const slug = document.getElementById('cliente-slug').value.trim().toLowerCase();
    if (!slug) {
      showFormError(clienteErrorEl, 'Informe o slug da barbearia.');
      return;
    }

    localStorage.setItem('barbersaas.slug', slug);
    window.location.href = `index.html?b=${slug}`;
  });

    /* ══════════════════════════════════════════════════
      SUBMIT: LOGIN COLABORADOR (MANUAL)
      1) Valida usuario e senha na tabela barbeiros
      2) Salva id do colaborador no localStorage
      3) Redireciona para dashboard-colaborador.html
    ══════════════════════════════════════════════════ */
  const collabLoginForm = document.getElementById('form-collab-login');
  const collabEmailInput = document.getElementById('collab-login-username');
  const collabPasswordInput = document.getElementById('collab-login-password');
  const collabError = document.getElementById('collab-error');
  const collabSubmit = document.getElementById('btn-collab-login-submit');

  if (collabLoginForm && collabEmailInput && collabPasswordInput && collabError && collabSubmit) {
    collabLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFormError(collabError);

      const username = collabEmailInput.value.trim();
      const password = collabPasswordInput.value;

      if (!username || !password) {
        showFormError(collabError, 'Informe usuario e senha para entrar.');
        return;
      }

      setLoading(collabSubmit, true);
      try {
        const { colaborador, error } = await AuthService.loginManual(username, password);
        if (error || !colaborador) {
          showFormError(collabError, error?.message || 'Usuario ou senha invalidos.');
          return;
        }

        localStorage.setItem('barbersaas.collab_id', String(colaborador.id));
        localStorage.setItem('barbersaas.slug', String(colaborador.barbearia_slug || ''));
        localStorage.setItem('colaborador_logado', JSON.stringify(colaborador));
        window.location.href = `dashboard-colaborador.html?b=${encodeURIComponent(colaborador.barbearia_slug || '')}`;
      } catch (err) {
        console.error('[Auth] colaborador login error:', err);
        showFormError(collabError, 'Nao foi possivel entrar como colaborador.');
      } finally {
        setLoading(collabSubmit, false);
      }
    });
  }

});

window.AuthService = AuthService;
