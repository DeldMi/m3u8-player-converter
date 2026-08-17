# M3U8 Player + Converter

Aplicação web local para:

- reproduzir URLs `.m3u8` em tela grande;
- adicionar vários links a uma fila;
- continuar adicionando links enquanto outro vídeo está sendo processado;
- baixar/converter M3U8 para MP4 usando FFmpeg;
- mostrar progresso;
- disponibilizar o MP4 automaticamente quando terminar;
- usar HLS.js para reprodução no navegador.

## Requisitos

- Node.js 18 ou superior
- FFmpeg instalado e disponível no `PATH`

### Ubuntu / WSL

```bash
sudo apt update
sudo apt install -y ffmpeg
```

### Windows

Instale o FFmpeg e coloque a pasta `bin` no PATH do Windows.

## Instalação

```bash
npm install
npm start
```

Depois abra:

http://localhost:3000

## Como funciona

O navegador reproduz o M3U8 diretamente com HLS.js.

Ao clicar em **Adicionar**, o servidor coloca o link na fila. O FFmpeg tenta primeiro fazer **remux** (copiar os codecs sem recodificar). Se isso não funcionar, ele tenta transcodificar para H.264 + AAC.

Os arquivos concluídos ficam na pasta:

`downloads/`

## Observações importantes

1. Alguns servidores M3U8 exigem cookies, Referer, User-Agent ou autenticação. Esta versão não implementa esses cabeçalhos.
2. Alguns streams são protegidos por DRM; nesses casos o FFmpeg não deve ser usado para contornar a proteção.
3. Para publicar esta aplicação na internet, adicione autenticação e uma política de URLs permitidas. Aceitar URLs arbitrárias em um servidor público pode criar risco de SSRF.
4. O player no navegador pode funcionar mesmo quando o FFmpeg não consegue acessar o mesmo stream, por diferenças de CORS, headers ou autenticação.

Versão corrigida para Windows 10.

## Principais correções

- FFmpeg configurado em `C:\ffmpeg\bin\ffmpeg.exe`.
- Tratamento do erro `spawn ffmpeg ENOENT`.
- O servidor não cai quando o FFmpeg não consegue iniciar.
- Progresso deixa de ficar preso em 99%.
- Quando o arquivo realmente existe, o estado muda para `✓ Concluído`.
- O botão `⬇ Baixar MP4` aparece ao lado do vídeo.
- Vídeo concluído passa a ser reproduzido pelo MP4 local.
- Quando o download termina, o player troca automaticamente do M3U8 para o MP4.
- Sidebar virou painel sobreposto e não redimensiona o player.
- Ao fechar a sidebar, aparece um botão flutuante para reabri-la.
- A fila continua trabalhando em segundo plano.

## Executar

No CMD:

```cmd
cd /d D:\Users\Felip\Videos\Descomprica\m3u8-player-converter
npm install
npm start
```

Depois abra:

http://localhost:3000

## FFmpeg

O projeto usa:

`C:\ffmpeg\bin\ffmpeg.exe`

## Observação

Durante o processamento, o player usa o M3U8. Assim que o MP4 termina e é validado, o player muda automaticamente para o arquivo local.

Isso evita depender continuamente do servidor M3U8 depois que o vídeo já foi baixado.

