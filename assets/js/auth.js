/* ====================================================
   AUTH.JS — BarberSaaS
   Arquivo: assets/js/auth.js

   RESPONSABILIDADE:
     Toda a lógica de autenticação e controle de acesso.
     É o único arquivo que lida com sessões, papéis e
     redirecionamentos baseados em permissão.

   MULTI-TENANCY — como os papéis funcionam:
     Cada usuário do Supabase Auth pode ser:
       'dono'     → tem registro em `barbearias.user_id`
       'barbeiro' → tem registro em `barbeiros.user_id`
       'cliente'  → nenhum dos dois (conta pública)

     Esse modelo permite que um único banco de dados
     sirva múltiplas barbearias sem misturar dados —
     cada barbearia é isolada pelo campo `barbearia_slug`.

   EXPÕE:
     AuthService — objeto com todos os métodos de auth

   DEPENDÊNCIAS:
     Deve ser carregado APÓS api.js (precisa de supabaseClient)
   ==================================================== */

'use strict';

const AuthService = {

  /* ─────────────────────────────────────────────────────
     SESSÃO ATIVA
     Verifica se há um usuário autenticado no momento.
     O Supabase persiste a sessão no localStorage
     automaticamente via SDK.
  ───────────────────────────────────────────────────── */

  /**
   * Retorna a sessão ativa ou null se não está autenticado.
   * @returns {Object|null} Supabase Session ou null
   */
  async getSession() {
    const { data } = await supabaseClient.auth.getSession();
    return data?.session ?? null;
  },


  /* ─────────────────────────────────────────────────────
     LOGIN / LOGOUT
  ───────────────────────────────────────────────────── */

  /**
   * Autentica o usuário com e-mail e senha via Supabase Auth.
   * @param   {string} email
   * @param   {string} password
   * @returns {Object} { user: User|null, error: Error|null }
   */
  async signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });
    return { user: data?.user ?? null, error };
  },

  /**
   * Encerra a sessão e redireciona para o portal de entrada.
   * Usa .replace() para que o usuário não possa voltar
   * para o dashboard com o botão "Voltar" do navegador.
   */
  async signOut() {
    await supabaseClient.auth.signOut();
    window.location.replace('portal.html');
  },


  /* ─────────────────────────────────────────────────────
     VERIFICAÇÃO DE PAPEL (ROLE)

     LÓGICA MULTI-TENANCY:
       1. Consulta `barbearias` WHERE user_id = userId
          → Se encontrado: papel = 'dono', barbearia = registro
       2. Consulta `barbeiros` WHERE user_id = userId
          → Se encontrado: papel = 'barbeiro', busca
            a barbearia pelo campo `barbearia_slug`
       3. Nenhum dos dois: papel = 'cliente'

     Essa hierarquia dupla (dono / barbeiro) permite que
     a mesma barbearia tenha um dono (acesso total) e
     múltiplos barbeiros (acesso filtrado por barbeiro_id).
  ───────────────────────────────────────────────────── */

  /**
   * Descobre o papel do usuário verificando as tabelas de negócio.
   * @param   {string} userId — UUID do Supabase Auth
   * @returns {Object} { isBarbeiro, role, barbearia, barbeiro }
   */
  async checkRole(userId) {
    // Passo 1 — verifica se é dono de uma barbearia
    const { data: barbearia } = await supabaseClient
      .from('barbearias')
      .select('id, slug, nome, whatsapp')
      .eq('user_id', userId)
      .maybeSingle();

    if (barbearia) {
      return {
        isBarbeiro: true,
        role:       'dono',
        barbearia,
        barbeiro:   null,
      };
    }

    // Passo 2 — verifica se é barbeiro individual
    const { data: barbeiro } = await supabaseClient
      .from('barbeiros')
      .select('id, nome, barbearia_slug')
      .eq('user_id', userId)
      .maybeSingle();

    if (barbeiro) {
      // Carrega os dados completos da barbearia a que pertence
      const { data: barb } = await supabaseClient
        .from('barbearias')
        .select('id, slug, nome, whatsapp')
        .eq('slug', barbeiro.barbearia_slug)
        .maybeSingle();

      return {
        isBarbeiro: true,
        role:       'barbeiro',
        barbearia:  barb,
        barbeiro,
      };
    }

    // Passo 3 — usuário comum (cliente)
    return { isBarbeiro: false, role: 'cliente', barbearia: null, barbeiro: null };
  },


  /* ─────────────────────────────────────────────────────
     GUARD DE ROTA — só para barbeiros e donos

     CONTROLE DE ACESSO (proteção de rota):
       1. Sem sessão            → redireciona para portal.html
       2. Sessão mas sem papel  → redireciona para index.html
       3. Tudo OK               → retorna contexto completo

     Deve ser chamado no início de toda página restrita
     (dashboard.html). Se retornar null, a execução foi
     interrompida por um redirecionamento.
  ───────────────────────────────────────────────────── */

  /**
   * Garante que o usuário atual é um barbeiro ou dono.
   * @returns {Object|null} { user, barbearia, role, barbeiro } ou null
   */
  async requireBarbeiro() {
    const session = await this.getSession();

    if (!session) {
      // Sem sessão → manda para o login
      window.location.replace('portal.html');
      return null;
    }

    const ctx = await this.checkRole(session.user.id);

    if (!ctx.isBarbeiro) {
      // Usuário autenticado mas sem papel de barbeiro → página do cliente
      window.location.replace('index.html');
      return null;
    }

    return { user: session.user, ...ctx };
  },
};
