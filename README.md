# Guru

Assistente de candidaturas para desktop. Com a vaga aberta na tela, você aperta um atalho e o Guru captura a tela, envia para o Claude junto com o seu perfil profissional e devolve um currículo feito para aquela vaga, pronto para exportar em PDF.

> Estado atual: MVP. Funciona em Linux (X11 e Wayland). Windows vem em seguida e macOS depois.

## Como funciona

1. Em **Meu perfil** você cadastra uma vez tudo o que já fez: experiências, formação, cursos, projetos, habilidades e idiomas. Quanto mais detalhe, melhor: o Claude escolhe o que serve para cada vaga. Para começar mais rápido:
   - **Importar currículo existente**: envie o currículo que você já tem (PDF, DOCX, imagem ou TXT) e o Claude preenche os campos. Nada que já está cadastrado é apagado: só entram campos vazios e itens novos.
   - **GitHub**: o Claude lê seus repositórios e READMEs e sugere projetos que faltam no perfil, dados incompletos em projetos já cadastrados e habilidades não listadas. Você revisa e aplica só o que quiser. O resumo de cada repositório fica salvo e, ao gerar um currículo, o Claude pode usar um repositório relevante para a vaga mesmo que ele não esteja no perfil.
2. Com a vaga aberta no navegador, aperte **Ctrl+Y**. O Guru captura o monitor onde está o mouse, abre com a captura e já começa a gerar o currículo. O atalho pode ser trocado em Configurações.
3. O Claude lê a vaga, seleciona e reescreve o conteúdo do seu perfil no idioma e no vocabulário da vaga.
4. Revise a prévia (dá para editar o texto clicando nele) e exporte o PDF.

O Guru avisa quais requisitos da vaga o seu perfil não cobre, em vez de inventar experiência para preenchê-los.

## Modo ao vivo

Além do atalho de um print (**Ctrl+Y**), o Guru tem um painel que acompanha a vaga enquanto você navega. Abra com **Ctrl+Alt+Y** ou pelo ícone do Guru na barra do sistema → **Modo ao vivo**.

- O painel abre no canto superior direito, por cima das outras janelas. Na primeira vez em cada sessão, o sistema pergunta qual tela compartilhar.
- Role a página da vaga normalmente. O painel compara a tela localmente, sem custo, e guarda um print novo quando você para de rolar. Os prints vão juntos ao Claude.
- A resposta aparece em tempo real, separada em tópicos: numa vaga, as seções do currículo (vaga, resumo, experiências, projetos, habilidades, pontos de atenção); num formulário como o da Gupy, um tópico por campo com a resposta pronta. Cada tópico tem botão de copiar.
- No chat do painel você pede alterações ("deixe o resumo mais curto") ou explicações. O tópico alterado é substituído no lugar.
- **Gerar currículo em PDF com esta vaga** abre a janela principal com os prints e os ajustes pedidos no chat.
- O próprio painel é coberto nos prints, para não aparecer na análise.

Cada análise automática custa por volta de US$ 0,05 a 0,10 com o Opus na API (metade com o Sonnet); o painel espera pelo menos 6 segundos entre análises. Pelo motor Claude Code, conta no limite da assinatura.

No GNOME com Wayland, o Guru roda via XWayland para o painel abrir no canto superior direito (no Wayland nativo o sistema ignora a posição pedida pela janela). O `npm run dev` e os atalhos já passam a opção certa; a captura de tela continua pelo portal do sistema. Para usar o Wayland nativo, rode `GURU_NATIVE_WAYLAND=1 npm run dev`: tudo funciona, mas o painel abre onde o GNOME decidir.

## Motor de IA

Em **Configurações → Motor de IA** você escolhe como o Claude roda:

| Motor | Custo | Observações |
|---|---|---|
| **API da Anthropic** (padrão) | Por uso, na sua conta da API | Modelos Opus e Sonnet. |
| **Claude Code** | Conforme autenticação do CLI | Requer Claude Code instalado e logado. |
| **API da OpenAI** | Por uso, na sua conta da API | Requer chave da OpenAI; modelos GPT selecionáveis. |
| **Codex CLI** | Conforme autenticação do CLI | Requer `codex` instalado e logado; usa o modelo padrão do Codex ou um GPT selecionado. |

O seletor mostra **Opus/Sonnet** para os motores Anthropic e modelos **GPT** para a API da OpenAI e o Codex CLI. A chave da OpenAI pode ser cadastrada em Configurações ou definida em `OPENAI_API_KEY`; ela é independente da chave da Anthropic. Para usar Codex CLI, instale o comando `codex` e faça login com `codex login`.

Como funciona o modo Claude Code: o app grava o print ou o arquivo numa pasta temporária, executa `claude -p` nela e apaga a pasta ao final. O Claude Code roda em modo restrito (`--restricted --tools Read`): só lê arquivos dessa pasta, não executa comandos e ignora suas configurações pessoais. A chave de API não é repassada a ele, para que o uso conte na assinatura.

> **Termos de uso:** a Anthropic restringe o uso de assinaturas do claude.ai por produtos de terceiros. O modo Claude Code existe para uso pessoal, com o Claude Code e a conta da própria pessoa. Na dúvida, use a API. No Windows, por enquanto, ele só funciona com o instalador nativo do Claude Code (`claude.exe`).

## Privacidade

- O perfil fica em um arquivo JSON na pasta de dados do app, só no seu computador (`~/.config/guru` no Linux).
- Ao gerar um currículo, vão para o Claude apenas a captura da vaga e o conteúdo profissional do perfil. Nome, e-mail, telefone e links são inseridos no PDF localmente.
- Ao importar um currículo existente, o arquivo vai inteiro para o Claude, incluindo os dados de contato que estiverem nele, porque é assim que ele preenche os dados pessoais.
- Na análise do GitHub, vão para o Claude os metadados e o README (truncado) dos 30 repositórios mais recentes. Sem token, só os públicos; com `GITHUB_TOKEN`, os privados também. O código-fonte não é enviado.
- A chave de API é guardada criptografada no cofre de senhas do sistema (via `safeStorage` do Electron).

## Requisitos

- Node.js 20 ou mais recente
- Uma chave de API da Anthropic, criada em [console.anthropic.com](https://console.anthropic.com/settings/keys). Cada currículo gerado é cobrado na sua conta.

## Rodando

```bash
git clone <url-do-repositorio>
cd guru
npm install
npm run dev
```

Na primeira execução, abra **Configurações** e cole a sua chave. Ela fica criptografada no cofre de senhas do sistema.

### Variáveis de ambiente (opcional)

Em desenvolvimento o app também lê um arquivo `.env` na raiz do projeto:

```bash
cp .env.example .env
```

| Variável | Para que serve |
|---|---|
| `ANTHROPIC_API_KEY` | Alternativa a cadastrar a chave da Anthropic em Configurações. A chave salva tem prioridade. |
| `OPENAI_API_KEY` | Alternativa a cadastrar a chave da OpenAI em Configurações. A chave salva tem prioridade. |
| `GITHUB_TOKEN` | Opcional. Inclui seus repositórios privados na análise do GitHub. Sem ele, só os públicos são lidos. |

Variáveis já definidas no terminal têm prioridade sobre o `.env`. O app empacotado não lê `.env`.

### Não vaze suas chaves

- O `.env` está no `.gitignore`. Nunca coloque chaves no `.env.example`, que é público.
- O `.gitignore` também bloqueia PDFs, DOCX e cópias de `profile.json`/`settings.json`, para que um currículo de teste ou seus dados pessoais não sejam commitados por engano.
- Se uma chave vazar (commit, print, chat), revogue-a no console da Anthropic e crie outra: apagar o commit não basta, porque o histórico do git e os clones guardam o conteúdo.

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm run dev` | Abre o app em modo de desenvolvimento, com recarga automática |
| `npm run build` | Gera o build de produção em `out/` |
| `npm start` | Abre o build de produção |
| `npm run typecheck` | Checa os tipos do TypeScript |

## Atalho no Wayland

No Wayland o sistema controla os atalhos globais.

- **GNOME:** ao abrir, o Guru cria um atalho personalizado nas configurações de teclado do sistema, chamado "Guru: capturar vaga". Ele aparece em Configurações → Teclado → Atalhos personalizados e pode ser removido por lá. O atalho global do Electron não é usado no GNOME, porque o portal do Wayland aceita o registro mas não entrega a tecla ao app.
- **Outros ambientes (KDE etc.):** o atalho é registrado pelo portal do sistema (xdg-desktop-portal), que pode pedir confirmação na primeira vez.

A captura de tela também passa pelo portal e pode abrir o seletor de tela.

Se o atalho não responder, crie à mão um atalho personalizado nas configurações de teclado do sistema que execute:

```bash
/caminho/para/guru --capture
```

Com o Guru já aberto, esse comando apenas dispara a captura na instância em execução.

## Estrutura

```
src/
  main/          processo principal do Electron
    index.ts     janela, bandeja, atalho global e IPC
    capture.ts   captura de tela
    claude.ts    prompts e tarefas (gerar currículo, importar perfil, analisar GitHub)
    engine*.ts   motores de IA: API da Anthropic ou Claude Code (claude -p)
    live.ts      modo ao vivo: conversa em streaming com os prints da tela
    panel.ts     janela do painel ao vivo
    resume-file.ts  leitura do currículo importado (PDF, DOCX, imagem, TXT)
    pdf.ts       template HTML do currículo e exportação para PDF
    github.ts    busca de repositórios e READMEs no GitHub
    store.ts     perfil e configurações em disco
  preload/       ponte segura entre a interface e o processo principal
  renderer/      interface em React (janela principal e painel ao vivo em src/panel/)
  shared/        tipos, schemas do Claude e a mesclagem do perfil importado
```

## Roadmap

- [x] Perfil-mestre com salvamento automático
- [x] Atalho global e captura de tela
- [x] Currículo sob medida via Claude, com aviso de requisitos não cobertos
- [x] Prévia editável e exportação em PDF
- [x] Análise dos repositórios do GitHub com sugestões para o perfil e catálogo usado na geração
- [ ] Login com GitHub (OAuth) em vez de token no `.env`
- [x] Importação de currículo existente (PDF, DOCX, imagem, TXT) para preencher o perfil
- [ ] Histórico de candidaturas (vaga, data, PDF gerado, status)
- [x] Motor alternativo pelo Claude Code com a assinatura (experimental) e escolha entre Opus e Sonnet
- [ ] Mais templates de currículo
- [x] Modo ao vivo: painel com sugestões em tempo real por tópico, inclusive respostas por campo em formulários
- [ ] Inserir as respostas direto nos campos (extensão de navegador)
- [ ] Instaladores para Linux e Windows; depois macOS
  - No Linux, o pacote precisa configurar o sandbox do Chromium (perfil do AppArmor ou `chrome-sandbox` com SUID). Em desenvolvimento o atalho do GNOME usa `--no-sandbox` para contornar isso.

## Problemas comuns

**`Cannot read properties of undefined (reading 'commandLine')` ao iniciar.** A variável `ELECTRON_RUN_AS_NODE` está definida no seu terminal (alguns editores a definem). Rode `unset ELECTRON_RUN_AS_NODE` e tente de novo.

**"O sistema não tem um cofre de senhas disponível".** Em Linux sem gnome-keyring ou KWallet, a chave não pode ser guardada com segurança. Use a variável de ambiente `ANTHROPIC_API_KEY`.

## Licença

MIT
