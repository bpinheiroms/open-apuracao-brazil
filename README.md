# open-apuracao-brazil

![Painel de apuração com o mapa do Brasil por município, placar, gráfico da apuração e lista de estados](docs/screenshot.png)

Painel interativo de apuração eleitoral do Brasil: um mapa navegável por estado, município e zona eleitoral, com placar, linha do tempo e andamento da contagem.

> [!NOTE]
> Este fork adiciona **infraestrutura de dados ao vivo do TSE** ao projeto original de **Bruno Pinheiro** ([@bpinheiroms](https://github.com/bpinheiroms)), [open-apuracao-brazil](https://github.com/bpinheiroms/open-apuracao-brazil). A interface, o mapa e a simulação são todos dele, e o fork mexe o mínimo possível no código dele. Veja [Dados ao vivo do TSE](#dados-ao-vivo-do-tse).

> [!WARNING]
> **Sem o coletor, todos os resultados são simulados.** Votos, percentuais, comparecimento e ritmo de apuração são gerados no navegador por um modelo determinístico. O projeto não consulta o TSE nem qualquer serviço eleitoral, e nada aqui representa o resultado de uma eleição real. Os nomes de candidatos servem só para dar forma à interface.

## O que tem

- **Mapa em três níveis.** Brasil, os municípios de um estado e as zonas eleitorais de um município (as 57 da capital paulista, por exemplo). São 5.570 municípios desenhados em Canvas 2D, com zoom, arraste e pinça.
- **Modos de mapa.** Recorte por estados, por municípios ou por eleitorado (um círculo por município, com área proporcional ao número de eleitores). Cor por quem lidera e com que vantagem, ou por quanto já foi apurado.
- **Placar do recorte aberto.** Mostra sempre o lugar que você está vendo e responde "ainda pode virar?" comparando os votos que faltam com a diferença atual. Para presidente, diz também se haverá 2º turno.
- **Linha do tempo.** Volte a qualquer minuto entre 17h e 23h, ou acompanhe "ao vivo" a simulação avançando.
- **Andamento.** Gráfico do percentual de cada candidato conforme as seções entram, participação, estados que viraram de lado e os últimos boletins. Clicar num ponto do gráfico leva o mapa àquele momento.
- **Busca** por estado ou município (tecla `/`), **tema claro e escuro** e **download do mapa** em PNG.
- **Tudo na URL.** Lugar, cargo, horário e modo do mapa fazem parte do link, e o botão voltar do navegador sobe um nível no mapa.
- **Responsivo.** Três colunas em telas largas, mapa e painel com abas em telas médias, e uma gaveta sobre o mapa no celular. No desktop a página não rola: o mapa ocupa a altura disponível.

## Dados ao vivo do TSE

O app original roda 100% no navegador, com dados simulados. Para mostrar dados reais a milhares de pessoas sem que cada visitante chame o TSE, o fork usa **um único coletor** e **arquivos estáticos atrás de uma CDN**:

```
resultados.tse.jus.br
        │  1 processo, ≤3 requisições em paralelo, ?t=<minuto>, pausa em 429/403
        ▼
 infra/collector.mjs ──► live/status.json        (~1 KB, muda a cada rodada)
   (a cada 60 s)          live/snap/<min>-<hash>.json  (snapshot imutável, ~60 KB em br)
                          live/history.json      (Brasil + 27 UFs por rodada, p/ o gráfico)
        │
        ▼
 infra/serve.mjs  ── ETag/304, br/gzip pré-comprimidos, Cache-Control, /healthz
        │
        ▼
   CDN (Cloudflare)  s-maxage=15, stale-while-revalidate=30, stale-if-error=600
        │
        ▼
   navegadores: leem status.json a cada ~15 s e só baixam um snapshot novo quando ele muda
```

- **Coletor** (`infra/collector.mjs`, sem dependências). A cada rodada lê o total do Brasil e os 27 arquivos `-ab.json` (situação por município, sem votos) e baixa de novo só os municípios cujo horário ou número de seções mudou, até 800 por rodada, sempre começando pelos que estão há mais tempo sem atualizar. A tabela TSE→IBGE vem do `mun-e00<ELE>-cm.json` do próprio TSE. O estado fica em disco, então reiniciar o coletor não baixa tudo de novo. Ele não chama o TSE por visitante: o número de requisições depende do andamento da apuração, não da audiência.
- **Snapshots imutáveis.** Cada snapshot tem o hash no nome e vai com `Cache-Control: immutable`; o único arquivo que muda é o `status.json`, de 1 KB, que aponta para o snapshot atual. O histórico guarda um snapshot a cada 5 minutos, e a linha do tempo usa esses snapshots para voltar no tempo.
- **Frontend.** `src/data/live.js` traduz o formato do TSE para o mesmo formato de resultado que a simulação produz, então os componentes não mudaram. Se existir `/live/status.json`, o app entra no modo ao vivo: o selo "Simulação" vira "TSE · hh:mm" e fica âmbar com "Atrasado" quando a última coleta passa de 3 minutos. Ao vivo só há o cargo de presidente, e as zonas eleitorais ficam sem cor porque o TSE não publica resultado por zona nesses arquivos. A série do gráfico cobre o Brasil e os estados. `?simulado` força a simulação, e o build com `VITE_LIVE=1` (o da imagem Docker) nunca cai para dados simulados.
- **Saúde.** `GET /healthz` responde 200 com a idade da última coleta e 503 se ela passar de `STALE_S` (180 s).

### Rodar localmente, sem tocar no TSE

```sh
npm install && npm run build
npm run mock:tse                                                     # TSE falso (usa a simulação do app, 10x mais rápido)
TSE_BASE=http://127.0.0.1:8787/oficial/ele2026 npm run collect       # outro terminal
npm run serve                                                        # outro terminal → http://127.0.0.1:8080
```

### Configuração

| Variável | Padrão | |
| --- | --- | --- |
| `ELE` | `6257` | Eleição. Presidente 1º turno 2026 = `6257`; 2º turno = `6258` |
| `CARGO` / `CANDS` | `0001` / `22,13` | Cargo e os dois candidatos do placar (os demais somam em "outros") |
| `INTERVAL_S` | `60` | Intervalo entre rodadas. O `?t=` muda a cada minuto, então menos que isso não traz dado novo |
| `PARALLEL` / `MAX_PER_TICK` | `3` / `800` | Limite de requisições em paralelo (no máximo 3) e de municípios por rodada |
| `OUT` / `PORT` / `STALE_S` | `live` / `8080` / `180` | Pasta dos JSON, porta, limite de atraso do `/healthz` |

Governador (`6259`/`6260`, cargo `0003`) tem candidatos diferentes em cada estado, e a interface foi feita para dois candidatos nacionais. Por isso esse cargo ficou de fora.

### Deploy

Um contêiner roda o coletor e o servidor juntos (`Dockerfile`). Exemplo no Fly.io: `fly launch --now`, com um volume em `/data` se quiser manter histórico e estado entre deploys. Railway (`railway up`) e qualquer VM com Docker também servem. Na frente, coloque o domínio na Cloudflare (plano gratuito) com uma **Cache Rule** para `/live/*` como "Eligible for cache", respeitando o `Cache-Control` da origem, porque a Cloudflare não guarda `.json` em cache por padrão. Com `s-maxage=15`, cada ponto de presença da CDN pede cada arquivo à origem no máximo uma vez a cada 15 s, qualquer que seja a audiência.

Por que não as outras opções: um cron do GitHub Actions roda no mínimo a cada 5 minutos e costuma atrasar, o que não serve para acompanhar ao vivo. Um Cloudflare Worker no plano gratuito tem limite de 50 subrequisições por execução, pouco para manter 5.570 municípios em dia sem fila e armazenamento extra. Um processo Node com uma CDN na frente é a solução mais simples que funciona e roda em qualquer lugar.

### Teste de carga

Rodado numa VM pequena e compartilhada (2 vCPU, 2 GB, já sobrecarregada por outros processos, com load average entre 7 e 19), com o autocannon na mesma máquina e 1.000 conexões simultâneas contra a origem, **sem CDN**:

| Alvo | Resultado |
| --- | --- |
| `status.json` (1,2 KB br) | ~785 req/s, 17 mil requisições em 35 s, p50 1,5 s, nenhum erro |
| revalidação com `If-None-Match` (304) | ~640 req/s, 12 mil requisições em 25 s |
| snapshot (~60 KB) | ~330 req/s (~20 MB/s), com timeouts: a CPU da VM saturou |
| `status.json` com coletor e TSE falso rodando juntos | 27 mil respostas em 65 s; o TSE falso recebeu **695 requisições, todas de uma única rodada do coletor** e nenhuma vinda dos clientes |

Numa outra rodada (130 s com 1.000 conexões), o TSE falso recebeu exatamente 2 × 855 requisições, ou seja, duas rodadas do coletor. O 855 sai alto porque o TSE falso roda 20x mais rápido e todo município muda a cada rodada. Com o TSE real e apuração em ritmo normal, uma rodada faz cerca de 55 requisições mais os municípios que mudaram. Os números de throughput mostram o mínimo que uma máquina sobrecarregada aguenta. Em produção, quem atende os clientes é a CDN, e a origem recebe poucas requisições por minuto.

## Como rodar

Requisitos: [Node.js](https://nodejs.org) 20.19 ou mais recente (exigência do Vite 7) e npm.

```sh
git clone https://github.com/bpinheiroms/open-apuracao-brazil.git
cd open-apuracao-brazil
npm install
npm run dev
```

O Vite imprime o endereço local, normalmente http://127.0.0.1:5173. Não há variáveis de ambiente, chaves de API nem backend: depois de carregar os arquivos de `public/`, tudo roda no navegador.

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento com recarga automática |
| `npm run build` | Gera o site estático em `dist/` |
| `npm run preview` | Serve o conteúdo de `dist/` para conferência |
| `npm test` | Roda os testes com o executor nativo do Node |

O resultado de `npm run build` é um site estático e pode ser publicado em qualquer hospedagem de arquivos. Os caminhos são absolutos (`/data/...`, `/fonts/...`), então o site precisa ficar na raiz do domínio; para publicar numa subpasta, configure `base` no Vite.

## Como usar

- Clique em um estado para abrir seus municípios e em um município para abrir o recorte dele. O botão com seta acima do mapa, a tecla `Esc` e o voltar do navegador sobem um nível.
- Acima do mapa ficam os controles de recorte (Estados, Municípios, Eleitorado) e de cor (Quem lidera, Apurado).
- Arraste para mover. Use `+`/`−`, a roda do mouse ou a pinça para aproximar.
- Arraste a linha do tempo para mudar o horário; "Ao vivo" volta à simulação em andamento.
- `/` abre a busca; setas e `Enter` escolhem um resultado.

### Formato da URL

```
/#SP/3550308/12?cargo=senado&hora=20h15&mapa=municipios&cor=apurado
```

| Parte | Significado | Padrão |
| --- | --- | --- |
| `SP` | Estado aberto (sigla da UF) | Brasil |
| `3550308` | Município aberto (código do IBGE) | nenhum |
| `12` | Zona eleitoral selecionada | nenhuma |
| `cargo` | `presidente`, `governadores`, `senado` ou `deputados` | `presidente` |
| `hora` | Horário da linha do tempo, de `17h00` a `23h00` | ao vivo |
| `mapa` | `estados`, `municipios` ou `eleitorado` | `estados` |
| `cor` | `lider` ou `apurado` | `lider` |

## Como a simulação funciona

Os números saem de `src/data/mocks.js`, sem aleatoriedade: o mesmo cargo e o mesmo minuto produzem sempre o mesmo resultado.

- Cada estado tem um percentual-alvo para o primeiro candidato. Os municípios variam em torno dele a partir de um hash do código do município, e uma calibração ajusta o conjunto até o estado bater no alvo.
- A apuração segue uma curva que avança rápido no começo e tem uma cauda longa. Cada município conta num ritmo próprio, e cerca de 1 em 14 atrasa bastante.
- As primeiras seções pendem para um dos lados e essa inclinação some até o fim da contagem. É o que dá movimento ao gráfico e faz alguns estados virarem.
- Os totais se conservam: a soma das zonas dá o município, a dos municípios dá o estado, e a dos estados dá o Brasil. Os testes verificam isso.
- As quatro abas de cargo são cenários diferentes do mesmo modelo, com os mesmos dois candidatos. Não representam candidaturas reais para cada cargo.

As zonas eleitorais são **áreas aproximadas** a partir dos locais de votação, dentro dos limites municipais. Não são limites oficiais do TSE.

## Organização do código

Preact com [htm](https://github.com/developit/htm) (sem JSX nem etapa de compilação de templates), CSS puro e Canvas 2D, empacotados com Vite.

```
index.html             página única; aplica o tema antes da primeira pintura
src/
  main.js              carrega a geometria e monta o app (ou a tela de erro)
  App.js               estado da página e composição das áreas
  components/          TopBar, Scoreboard, MapStage, MapModes, Legend, Timeline, Insights,
                       TrendChart, UpdatesFeed, SidePanel, PlaceRow, BackButton, SearchDialog, Icon
  hooks/               useRoute (URL), useClock, useHistory (parciais anteriores), useTheme,
                       useHotkey, useMediaQuery, useWidth
  map/                 ElectionMap (desenho, clique, zoom), geography (TopoJSON e câmeras),
                       mapTheme (cores do canvas), exportMap (PNG)
  data/                mocks (resultados e cores), history (série, boletins, viradas),
                       outlook ("ainda pode virar?"), clock
  lib/                 formatação pt-BR e o binding do htm
  styles/              tokens, base, layout, components, map
public/
  data/                brasil.topo.json (municípios) e zonas.json (zonas eleitorais)
  fonts/, images/      fonte Geist e retratos
tests/                 geometria, conservação dos votos, linha do tempo, câmeras, projeção
```

Algumas decisões que ajudam a ler o código:

- **O mapa é um canvas, os rótulos são HTML.** `ElectionMap` desenha os polígonos e testa cliques com `isPointInPath`; as siglas dos estados são botões posicionados por cima, para funcionarem com teclado e leitor de tela.
- **A URL é a fonte da verdade.** `useRoute` lê e escreve lugar, cargo, horário e modo do mapa. Mudar de lugar cria uma entrada no histórico; o resto só reescreve a entrada atual.
- **Três layouts**, descritos no topo de `src/styles/layout.css`: três colunas a partir de 1440px, mapa e painel com abas entre 1000px e 1439px, e gaveta inferior abaixo disso.
- **Dois temas.** As cores da interface são tokens em `src/styles/tokens.css`. O canvas não lê CSS, então `src/map/mapTheme.js` espelha o fundo e define os traços de cada tema.
- **Parciais anteriores sob demanda.** Cada ponto do gráfico exige recontar o país inteiro, então `useHistory` calcula um por vez depois da primeira pintura e guarda o resultado por cargo.

## Testes

```sh
npm test
```

Os testes rodam em Node, sem navegador, e cobrem: a geometria (5.570 municípios, 27 estados, 57 zonas na capital paulista), a conservação dos votos entre os níveis, o determinismo da linha do tempo, o enquadramento das câmeras, a projeção do que falta apurar e a contagem de lugares por candidato. O desenho no canvas e a interação são conferidos manualmente no navegador.

## Créditos

- **Malha municipal:** [IBGE](https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html), simplificada e convertida para TopoJSON.
- **Arquivos de dados e retratos:** `public/data/brasil.topo.json`, `public/data/zonas.json` e as imagens em `public/images/` foram obtidos de [seuimposto.com](https://seuimposto.com/) e não são de autoria deste projeto. Confira os direitos de uso antes de redistribuí-los.
- **Fonte:** [Geist](https://vercel.com/font), da Vercel, sob a SIL Open Font License.

## Licença

O código deste repositório está sob a licença [MIT](LICENSE). Os arquivos listados em Créditos pertencem aos respectivos autores e não são cobertos por ela. A infraestrutura deste fork (`infra/`, `src/data/live.js`) é distribuída sob a mesma licença MIT, mantendo o aviso de copyright original.
