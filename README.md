# Quotex Monitor

Monitor de leitura para coletar dados visíveis da Quotex com Playwright e gravar no Supabase.

## O que ele faz

- roda pelo GitHub Actions a cada 5 minutos;
- abre a página configurada da Quotex;
- procura pares como `EUR/GBP (OTC)`;
- tenta extrair variação 24h, payout de 1+ minuto e payout de 5+ minutos;
- grava/atualiza os ativos na tabela `quotex_assets` do Supabase;
- gera `debug.png` e `debug.txt` quando a execução falha.

Ele é somente para leitura/monitoramento. Não executa operações e não tenta contornar CAPTCHA, 2FA ou bloqueios da plataforma.

## 1. Criar a tabela no Supabase

Abra o SQL Editor do Supabase e execute o conteúdo de `supabase.sql`.

## 2. Configurar GitHub Actions Secrets

No repositório:

Settings → Secrets and variables → Actions → New repository secret

Crie:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `QUOTEX_URL` (opcional; se vazio usa `https://qxbroker.com/en/demo-trade/`)
- `QUOTEX_STORAGE_STATE_B64` (necessário somente se a página exigir sessão autenticada)

Nunca coloque essas chaves diretamente nos arquivos do repositório.

## 3. Testar

Abra:

Actions → Quotex monitor → Run workflow

Se falhar, abra a execução e baixe o artifact `quotex-debug`. Ele contém uma captura da tela e o texto que o monitor conseguiu enxergar.

## Observações

GitHub Actions aceita agendamento de 5 minutos, mas execuções agendadas podem atrasar. Em repositórios públicos, workflows agendados também podem ser desativados pelo GitHub após longos períodos sem atividade no repositório.
