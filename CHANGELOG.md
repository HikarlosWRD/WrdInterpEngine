# Changelog

## 1.1.0 — Persistent Worker & Safe Auto Warm-up

### Added

- Worker Python persistente.
- Reutilização do modelo e dos kernels ROCm entre clipes.
- Pré-aquecimento automático Full HD após 30 segundos.
- Barra de progresso integrada à extensão.
- Controles para pausar e iniciar o aquecimento manualmente.
- Detecção de resolução já aquecida na sessão.
- Teste diagnóstico de duas execuções no mesmo worker.

### Performance

- Primeiro par aquecido reduzido de aproximadamente 58 segundos para aproximadamente 3 segundos.
- Teste Full HD x16 com 10 pares reduzido de aproximadamente 84 para 28 segundos na segunda execução.

### AMD stability

- Pré-aquecimento dividido em etapas.
- Processo de pré-aquecimento em prioridade baixa.
- `MIOPEN_COMPILE_PARALLEL_LEVEL=1`.
- Pausas e sincronizações entre etapas pesadas.
- Validação de tensores e do contexto ROCm.
- Nenhuma repetição automática após erro real de pré-aquecimento.

### x32

- Encoder AMD desativado no x32 e em saídas acima de 500 FPS.
- Uso de `libx264` para evitar competição com o ROCm.
- Inferência dividida em rajadas menores e sincronizações periódicas.

### Fixed

- Tratamento de MP4 bloqueado pelo After Effects.
- Fallback indevido após erro de arquivo bloqueado.
- Codificação UTF-8 no processo original.
- Erros `cp1252` no Windows.
