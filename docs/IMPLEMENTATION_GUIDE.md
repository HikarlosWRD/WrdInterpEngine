# Kit de integração AE + GitHub

## Auditoria
O arquivo enviado tinha 5 partes, cerca de 2,43 GB compactados, 6,73 GB descompactados e 35.133 arquivos. A maior parte era a `.venv`, que não deve ir ao GitHub nem ser movida entre pastas.

## Payload mínimo
O asset final tem aproximadamente 47,87 MB e contém somente:
- scripts Python do motor;
- GMFSS completo;
- quatro pesos `.pkl`;
- instalador ROCm/PyTorch;
- teste de GPU;
- licença.

Removidos: `.venv`, logs, BATs, `__pycache__`, `.pyc`, scripts de reparo e arquivos de teste.

## Publicação
1. Crie uma GitHub Release com tag `interp-engine-v1.0.0`.
2. Anexe `WrdInterpEngine-runtime-win-amd-v1.0.0.zip`.
3. Troque `OWNER/REPOSITORY` em `release-manifest.json`.
4. Coloque o manifesto no repositório, por exemplo em `releases/release-manifest.json`.
5. Troque `OWNER/REPOSITORY` em `example-panel-integration.js`.

## Instalação com um clique
A extensão chama `installEngine()`. O instalador:
- baixa o manifesto;
- baixa o asset;
- valida SHA-256;
- instala em `%LOCALAPPDATA%\WrdUtilities\InterpEngine`;
- instala Python 3.12 se necessário;
- cria a `.venv` no local final;
- instala ROCm 7.2.1 e PyTorch AMD;
- testa a GPU;
- grava `install-state.json`.

## Estrutura no repositório
```text
extension/interpolation/engine-manager.js
extension/interpolation/install-engine.ps1
releases/release-manifest.json
```

O asset pesado deve ficar na GitHub Release, não no histórico Git.


## Instalador portátil v1.3

O instalador não usa mais Winget nem uma instalação global de Python.

Ele baixa o CPython embeddable 3.12.10 diretamente do python.org, valida
o SHA-256 `4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3`, habilita `site-packages`, instala o pip
26.1.2 validado por SHA-256 e instala o runtime dentro do próprio motor.

Caminho definitivo:

```text
%LOCALAPPDATA%\WrdUtilities\InterpEngine\python\python.exe
```
