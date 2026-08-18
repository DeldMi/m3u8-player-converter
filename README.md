# M3U8 Player + Converter (M3U8 Studio v3)

O **M3U8 Player + Converter** é uma aplicação web local focada em reprodução eficiente de streams HLS e conversão automatizada para MP4. Desenvolvido para facilitar o gerenciamento de filas, permite assistir, converter e baixar vídeos de forma intuitiva.

---

## 📑 Documentação e Políticas
Para garantir transparência e conformidade, consulte os documentos abaixo:

* [📄 Licença (LICENSE.md)](LICENSE.md) - Detalhes sobre o uso e distribuição.
* [🛡️ Política de Segurança (SECURITY.md)](SECURITY.md) - Como relatar vulnerabilidades.
* [🔒 Privacidade e Responsabilidade (PRIVACY.md)](PRIVACY.md) - Termos de uso e privacidade.

---

## 🚀 Funcionalidades Principais

* **Reprodução:** HLS.js integrado para visualização fluida de URLs `.m3u8`.
* **Gerenciamento de Fila:** Adição de múltiplos links sem interromper o vídeo atual.
* **Conversão Inteligente:** FFmpeg com tentativa de remux (cópia de stream) ou transcodificação (H.264 + AAC).
* **Automação:** Troca automática do player de M3U8 para MP4 local ao concluir o download.
* **Interface Moderna:** Sidebar sobreposta, notificações em tempo real e ordenação de fila (A-Z, Z-A, Status).

---

## ⚙️ Pré-requisitos

* **Node.js:** Versão 18 ou superior.
* **FFmpeg:** Instalado e configurado no `PATH`.
    * *Ubuntu/WSL:* `sudo apt install -y ffmpeg`
    * *Windows:* Certifique-se de que o executável esteja em `C:\ffmpeg\bin\ffmpeg.exe` (ou ajuste no código).

---

## 📥 Instalação e Execução

### No Windows (CMD/PowerShell)
```cmd
cd /d C:\www\m3u8-player-converter
npm install
npm start
