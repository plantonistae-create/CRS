# Acceptance checks — Internação / Chamador / Recepção

- Aba antes chamada `Censo` aparece como `Internação`, mantendo internamente a rota `#censo` e os dados existentes.
- `Chamador` exibe apenas os controles/lista de chamadas, sem a prévia da tela da recepção.
- `Recepção` aparece como aba própria na navegação.
- A tela de recepção continua recebendo os dados em tempo real da rota já existente `#recepcao`.
- A tela de recepção possui ação `Tela cheia` usando a Fullscreen API; quando ativa, somente o conteúdo da recepção ocupa a tela.
- O botão de áudio existente continua preservado.
- Nenhuma alteração é feita no backend, estados clínicos, Censo, Reavaliações, Prescrição ou Chamadas.
