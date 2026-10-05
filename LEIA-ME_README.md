# Moagem — Registos (v0.2.0, Fase A)

Aplicação para telemóvel, sem servidor, para **recepção de cereal (RG-21)** e **registo de silos e lotes (RG-13)** numa moagem. Funciona sem rede depois da primeira abertura. Os dados ficam **apenas no telemóvel**.

*English version below.*

---

## Novidades na v0.2.0
- **Cereal:** milho, trigo ou arroz. O milho exige a cor (Amarelo / Branco).
- **Classificação automática (SOP-OPS-001 Rev 1.0, §7):** humidade, matérias estranhas, grãos partidos, grãos doentes/com bolor e peso específico → Grau 1, Grau 2, Fora de grau ou Rejeitar. Gordura é registada mas não classifica. Odor anormal ou infestação → retido até decisão do CQ. Valores entre graus → grau inferior.
- **Silos designados** (cereal, cor, grau) e com capacidade. A aplicação mostra os silos livres para o grau do lote; um lote maior do que o espaço livre reparte-se pelos silos escolhidos, por ordem. Silo cheio não recebe. Amarelo e Branco nunca se misturam.
- **PIN do supervisor** para: alterar limites e silos, aceitar fora de grau, usar silo de grau diferente (com nome e motivo registados) e restaurar cópias. Rejeitar não tem excepção.
- **Descarga** por ordem de silos (esvazia o 1.º, depois o seguinte); bloqueada se não houver grão suficiente. Transferências verificam stock, espaço e grau.
- **Inspecções dos silos:** temperatura, humidade, odor, infestação, com alertas e frequência definidos pela empresa.
- Correcções: "30.000" kg lido como 30 000 kg; números inválidos assinalados; lotes nunca sobrescritos; cópia automática antes de restaurar; ficheiros de cópia validados; aviso de cópia de segurança com mais de 7 dias; pesquisa de lotes.
- **Nota:** as colunas do RG-21 exportado seguem o SOP e já não coincidem com o modelo RG-21 do kit.

## O que faz
- **Recepção:** novo lote com código automático `REC-AAMMDD-NN`, análises (humidade, impurezas, insectos, odor, aflatoxinas, DON, fumonisinas) e decisão automática ACEITAR / RETER / REJEITAR com o motivo.
  - A decisão final pode ser diferente da automática, mas exige motivo.
  - Os lotes retidos podem ser decididos mais tarde, também com motivo.
- **Silos:** entrada automática quando um lote é aceite; descarga para a linha; transferência entre silos/células; marcação de silo vazio. Mostra os lotes presentes desde o último esvaziamento (regra conservadora do PR-12) e a quantidade estimada.
- **Exportar:** Excel com as folhas RG-21 e RG-13, nas mesmas colunas do kit.
- **Cópia de segurança:** guardar e restaurar em ficheiro `.json`.
- **Definições:** nome da moagem, silos e capacidades, fornecedores e limites de aceitação por cereal. A aplicação **não traz limites pré-definidos**: a empresa define-os (PR-24).
- **Idiomas:** português (ortografia anterior ao AO90) e inglês.

## Publicar no GitHub Pages (sem programar)
1. Crie uma conta gratuita em github.com.
2. **New repository** → nome, por exemplo `moagem-app` → **Public** → **Create repository**.
   - Repositórios privados podem exigir um plano pago para o Pages: confirme nas condições actuais do GitHub.
3. **Add file → Upload files**: arraste **todo o conteúdo** desta pasta (ficheiros e pastas `css`, `js`, `vendor`, `icons`) → **Commit changes**.
4. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save**.
5. Ao fim de alguns minutos o endereço aparece na mesma página, por exemplo `https://<utilizador>.github.io/moagem-app/`.

Alternativas: Cloudflare Pages ou Netlify (arrastar a pasta). Qualquer alojamento de ficheiros estáticos com **HTTPS** serve: o modo sem rede exige HTTPS.

## Instalar no telemóvel
Abra o endereço no Chrome (Android) → menu ⋮ → **Adicionar ao ecrã principal** (ou **Instalar aplicação**). Abra-a uma vez com rede; depois funciona sem rede.

## Publicar uma nova versão
Altere `const CACHE = 'moagem-v0.1.0'` em `sw.js` (por exemplo para `v0.1.1`) e carregue os ficheiros alterados. Os telemóveis actualizam na próxima abertura com rede.

## Limitações conhecidas (Fase A)
- **Um telemóvel = uma base de dados.** Não há sincronização entre telemóveis nem cópia automática. Se o telemóvel se perder, perdem-se os dados posteriores à última cópia de segurança.
- **Os lotes gravados não se apagam nem se editam.** Foi propositado: é um registo de auditoria. Os erros corrigem-se com uma nota ou com a decisão de um lote retido. Uma função de correcção com histórico fica para a próxima versão.
- A quantidade nos silos é uma **estimativa** (entradas − saídas registadas).
- O simulacro de recolha, os ímanes/crivos e o lote de produção completo são as próximas etapas.
- A data e a hora vêm do relógio do telemóvel.

## Terceiros
`vendor/xlsx.mini.min.js`: SheetJS Community Edition 0.18.5, licença Apache 2.0 (`vendor/xlsx-LICENSE.txt`). Usado apenas para **criar** ficheiros Excel; a aplicação não abre ficheiros Excel de terceiros.

---

# Mill — Records (v0.2.0, Step A) — English

A serverless phone app for **grain intake (RG-21)** and **silo and lot records (RG-13)**. It works offline after the first load. Data stays **on the phone only**.

## New in v0.2.0
- Grain dropdown (maize, wheat, rice); maize colour (Amarelo/Branco) required.
- Automatic grading from SOP-OPS-001 Rev 1.0 §7 (Grade 1, Grade 2, Off-grade, Reject). Fat is recorded, not graded. Abnormal odour or infestation → held for QC.
- Silos have a fixed grain, colour, grade and capacity. Full silos can't be loaded; large loads split across silos in order.
- Supervisor PIN for limits/silos, off-grade acceptance, different-grade silos and restores.
- Discharge across silos in order; blocked when stock is short. Silo inspections with alerts.
- Fixes: thousands separators, no silent overwrites, safety copy before restore, backup validation, backup reminder, lot search.
- Note: the exported RG-21 columns now follow the SOP, not the kit's RG-21 template.

## Features
- **Intake:** auto lot code, tests, and an automatic ACCEPT / HOLD / REJECT decision with the reasons.
  - A final decision that differs from the automatic one needs a reason.
  - Held lots can be decided later.
- **Silos:**
  - Each accepted lot is entered into its silo automatically.
  - Draw-off to the line, transfers between silos/bins, and marking a silo as emptied.
  - Shows the lots present since the silo was last emptied, plus an estimated quantity.
- **Export:** Excel with the RG-21 and RG-13 sheets, using the kit's columns.
- **Backup:** save and restore a `.json` file.
- **Settings:** mill name, silos, suppliers and acceptance limits. No preset limits are included.
- **Languages:** Portuguese and English.

## Publish on GitHub Pages
Create a free GitHub account, then follow these steps:
1. Create a new **public** repository.
   - Private-repo Pages may need a paid plan; check GitHub's current terms.
2. **Add file → Upload files**: upload everything in this folder, then commit.
3. **Settings → Pages**: choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and save.
4. After a few minutes the URL appears on the same page.

Any static host with **HTTPS** also works (Cloudflare Pages, Netlify). Offline mode requires HTTPS.

## Install on a phone
Open the URL in Chrome → ⋮ menu → **Add to Home screen**. Open it once with signal; after that it works offline.

## Releasing an update
Change the version in `const CACHE` in `sw.js`, then upload the changed files.

## Known limitations
- **One phone = one database:** no sync and no automatic backup.
- **Saved lots can't be edited or deleted:** this is deliberate, to keep an audit trail.
- **Silo quantities are estimates:** recorded inflows minus outflows.
- **Not built yet:** mock recall, magnets/sieves and full production lots are the next steps.

## Third-party code
SheetJS Community Edition 0.18.5 (Apache 2.0). It is used only to **write** Excel files.
