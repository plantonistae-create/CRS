# CRS Coophavila — deploy

O Worker preserva os bindings e secrets já usados em produção:
- `CALL_ROOM` → Durable Object `CallRoom`
- `SESSION_SECRET`
- `ADMIN_PASSWORD`
- `MEDICO_PASSWORD`

Novo binding:
- `EXAMS_BUCKET` → R2 `crs-coophavila-exames`

O workflow `.github/workflows/deploy-cloudflare.yml` cria o bucket R2 se necessário e publica o Worker.
Para o GitHub Actions são necessários apenas estes repository secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

O token deve permitir editar Workers e R2 na conta correspondente.
