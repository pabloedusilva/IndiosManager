// ════════════════════════════════════════════════════════════════════════════
// Job Execution Logger - Helper para registrar execuções de jobs
// ════════════════════════════════════════════════════════════════════════════

const pool = require('../config/database')

/**
 * Registrar execução de um job
 * 
 * @param {string} jobNome - Nome do job (ex: 'gerar_relatorio_mensal')
 * @param {string} mesReferencia - Mês no formato YYYY-MM (opcional)
 * @param {string} status - sucesso | erro | sem_dados | ja_existe | duplicado
 * @param {string} mensagem - Mensagem descritiva
 * @param {string} erro - Detalhes do erro (opcional)
 * @param {number} duracaoMs - Duração em milissegundos (opcional)
 */
async function registrar(jobNome, mesReferencia, status, mensagem, erro = null, duracaoMs = null) {
  try {
    await pool.query(
      `INSERT INTO job_execucoes 
       (job_nome, mes_referencia, status, mensagem, erro, duracao_ms, executado_em)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [jobNome, mesReferencia, status, mensagem, erro, duracaoMs]
    )
    return true
  } catch (err) {
    console.error('[JobLogger] Erro ao registrar execução:', err.message)
    return false
  }
}

/**
 * Buscar últimas execuções de um job
 * 
 * @param {string} jobNome - Nome do job
 * @param {number} limite - Número máximo de registros (padrão: 10)
 */
async function buscarUltimas(jobNome, limite = 10) {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        job_nome,
        mes_referencia,
        status,
        mensagem,
        erro,
        duracao_ms,
        executado_em
       FROM job_execucoes
       WHERE job_nome = $1
       ORDER BY executado_em DESC
       LIMIT $2`,
      [jobNome, limite]
    )
    return result.rows
  } catch (err) {
    console.error('[JobLogger] Erro ao buscar execuções:', err.message)
    return []
  }
}

/**
 * Verificar se houve execução recente (últimas X horas)
 * 
 * @param {string} jobNome - Nome do job
 * @param {string} mesReferencia - Mês no formato YYYY-MM (opcional)
 * @param {number} horas - Número de horas para considerar como recente (padrão: 24)
 */
async function temExecucaoRecente(jobNome, mesReferencia = null, horas = 24) {
  try {
    let query = `
      SELECT COUNT(*) as total 
      FROM job_execucoes 
      WHERE job_nome = $1 
        AND executado_em > NOW() - INTERVAL '${horas} hours'
    `
    
    const params = [jobNome]
    
    if (mesReferencia) {
      query += ' AND mes_referencia = $2'
      params.push(mesReferencia)
    }
    
    const result = await pool.query(query, params)
    return parseInt(result.rows[0].total) > 0
  } catch (err) {
    console.error('[JobLogger] Erro ao verificar execuções recentes:', err.message)
    return false
  }
}

/**
 * Buscar estatísticas de execuções por status
 * 
 * @param {string} jobNome - Nome do job
 */
async function estatisticasPorStatus(jobNome) {
  try {
    const result = await pool.query(
      `SELECT 
        status,
        COUNT(*) as total,
        MAX(executado_em) as ultima_execucao
       FROM job_execucoes
       WHERE job_nome = $1
       GROUP BY status
       ORDER BY total DESC`,
      [jobNome]
    )
    return result.rows
  } catch (err) {
    console.error('[JobLogger] Erro ao buscar estatísticas:', err.message)
    return []
  }
}

/**
 * Limpar logs antigos (mais de X dias)
 * 
 * @param {number} dias - Número de dias para manter (padrão: 180 = 6 meses)
 */
async function limparAntigos(dias = 180) {
  try {
    const result = await pool.query(
      `DELETE FROM job_execucoes
       WHERE executado_em < NOW() - INTERVAL '${dias} days'
       RETURNING id`,
      []
    )
    return result.rowCount
  } catch (err) {
    console.error('[JobLogger] Erro ao limpar logs antigos:', err.message)
    return 0
  }
}

/**
 * Criar tabela job_execucoes se não existir
 */
async function criarTabelaSeNaoExistir() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_execucoes (
        id SERIAL PRIMARY KEY,
        job_nome VARCHAR(100) NOT NULL,
        mes_referencia VARCHAR(7),
        status VARCHAR(20) NOT NULL CHECK (status IN ('sucesso', 'erro', 'sem_dados', 'ja_existe', 'duplicado')),
        mensagem TEXT,
        erro TEXT,
        executado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        duracao_ms INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_job_execucoes_job_mes ON job_execucoes(job_nome, mes_referencia);
      CREATE INDEX IF NOT EXISTS idx_job_execucoes_executado ON job_execucoes(executado_em DESC);
      CREATE INDEX IF NOT EXISTS idx_job_execucoes_status ON job_execucoes(status);
    `)
    return true
  } catch (err) {
    console.error('[JobLogger] Erro ao criar tabela:', err.message)
    return false
  }
}

module.exports = {
  registrar,
  buscarUltimas,
  temExecucaoRecente,
  estatisticasPorStatus,
  limparAntigos,
  criarTabelaSeNaoExistir
}
