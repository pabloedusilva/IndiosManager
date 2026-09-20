// ════════════════════════════════════════════════════════════════════════════
// JOB: Geração Automática de Relatórios Mensais
// ════════════════════════════════════════════════════════════════════════════
// Executa todo dia 01 de cada mês às 03:00 AM (horário de Brasília)
// Gera o relatório do mês anterior com base nas estatísticas
// ════════════════════════════════════════════════════════════════════════════

const EstatisticasModel = require('../models/EstatisticasModel')

/**
 * Formatar data/hora para log
 */
function timestamp() {
  return new Date().toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/**
 * Obter mês anterior no formato YYYY-MM
 */
function obterMesAnterior() {
  const agora = new Date()
  const ano = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear()
  const mes = agora.getMonth() === 0 ? 12 : agora.getMonth()
  return `${ano}-${String(mes).padStart(2, '0')}`
}

/**
 * Registrar execução do job no banco
 */
async function registrarExecucao(mes, status, mensagem, erro = null) {
  const pool = require('../config/database')
  
  try {
    await pool.query(
      `INSERT INTO job_execucoes 
       (job_nome, mes_referencia, status, mensagem, erro, executado_em)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      ['gerar_relatorio_mensal', mes, status, mensagem, erro]
    )
  } catch (err) {
    console.error('[Job] Erro ao registrar execução:', err.message)
  }
}

/**
 * Verificar se o relatório do mês já foi gerado
 */
async function relatorioJaExiste(mes) {
  try {
    const relatorio = await EstatisticasModel.buscarRelatorio(mes)
    return relatorio !== null
  } catch (err) {
    console.error('[Job] Erro ao verificar relatório:', err.message)
    return false
  }
}

/**
 * Verificar se já houve tentativa de geração nas últimas 24h
 */
async function jaExecutouRecentemente(mes) {
  const pool = require('../config/database')
  
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as total 
       FROM job_execucoes 
       WHERE job_nome = $1 
         AND mes_referencia = $2 
         AND executado_em > NOW() - INTERVAL '24 hours'`,
      ['gerar_relatorio_mensal', mes]
    )
    
    return parseInt(result.rows[0].total) > 0
  } catch (err) {
    console.error('[Job] Erro ao verificar execuções recentes:', err.message)
    return false
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FUNÇÃO PRINCIPAL - Gerar Relatório do Mês Anterior
 * ════════════════════════════════════════════════════════════════════════════
 */
async function executar() {
  const mesAnterior = obterMesAnterior()
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`[Job] Geração de Relatório Mensal - ${timestamp()}`)
  console.log(`[Job] Mês de referência: ${mesAnterior}`)
  console.log('='.repeat(80))
  
  try {
    // ── 1. Verificar se o relatório já existe ─────────────────────────
    console.log('[Job] Verificando se relatório já foi gerado...')
    
    const jaExiste = await relatorioJaExiste(mesAnterior)
    
    if (jaExiste) {
      const mensagem = `Relatório de ${mesAnterior} já existe no banco de dados`
      console.log(`[Job] ✓ ${mensagem}`)
      await registrarExecucao(mesAnterior, 'ja_existe', mensagem)
      return { success: true, mesAnterior, status: 'ja_existe' }
    }
    
    // ── 2. Verificar se já tentou gerar nas últimas 24h ───────────────
    console.log('[Job] Verificando execuções recentes...')
    
    const jaExecutou = await jaExecutouRecentemente(mesAnterior)
    
    if (jaExecutou) {
      const mensagem = `Já houve tentativa de geração nas últimas 24h para ${mesAnterior}`
      console.log(`[Job] ⚠ ${mensagem}`)
      await registrarExecucao(mesAnterior, 'duplicado', mensagem)
      return { success: false, mesAnterior, status: 'duplicado' }
    }
    
    // ── 3. Buscar estatísticas do mês ─────────────────────────────────
    console.log('[Job] Buscando estatísticas do mês...')
    
    const stats = await EstatisticasModel.estatisticasMes(mesAnterior)
    
    if (!stats || !stats.resumo) {
      const mensagem = `Sem dados disponíveis para ${mesAnterior}`
      console.log(`[Job] ⚠ ${mensagem}`)
      await registrarExecucao(mesAnterior, 'sem_dados', mensagem)
      return { success: false, mesAnterior, status: 'sem_dados' }
    }
    
    // ── 4. Salvar relatório no banco ──────────────────────────────────
    console.log('[Job] Salvando relatório no banco de dados...')
    console.log(`[Job] Faturamento: R$ ${stats.resumo.faturamento.toFixed(2)}`)
    console.log(`[Job] Total de pedidos: ${stats.resumo.totalPedidos}`)
    console.log(`[Job] Finalizados: ${stats.resumo.finalizados}`)
    console.log(`[Job] Cancelados: ${stats.resumo.cancelados}`)
    
    await EstatisticasModel.salvarRelatorio(mesAnterior, stats)
    
    const mensagem = `Relatório de ${mesAnterior} gerado com sucesso`
    console.log(`[Job] ✓ ${mensagem}`)
    
    await registrarExecucao(
      mesAnterior, 
      'sucesso', 
      mensagem + ` - Faturamento: R$ ${stats.resumo.faturamento.toFixed(2)} | Pedidos: ${stats.resumo.totalPedidos}`
    )
    
    console.log('='.repeat(80))
    console.log(`[Job] Execução concluída com sucesso às ${timestamp()}`)
    console.log('='.repeat(80) + '\n')
    
    return { 
      success: true, 
      mesAnterior, 
      status: 'gerado',
      stats: stats.resumo 
    }
    
  } catch (erro) {
    const mensagem = `Erro ao gerar relatório de ${mesAnterior}`
    console.error(`[Job] ✗ ${mensagem}:`, erro.message)
    console.error(erro.stack)
    
    await registrarExecucao(mesAnterior, 'erro', mensagem, erro.message)
    
    console.log('='.repeat(80))
    console.log(`[Job] Execução finalizada com erro às ${timestamp()}`)
    console.log('='.repeat(80) + '\n')
    
    return { 
      success: false, 
      mesAnterior, 
      status: 'erro', 
      erro: erro.message 
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  executar,
  obterMesAnterior,
  relatorioJaExiste
}
