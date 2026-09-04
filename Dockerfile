FROM node:20-bookworm-slim

# Install Python, pip, and ffmpeg (needed by yt-dlp to merge Bilibili's
# separate video/audio streams into one playable mp4).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp itself (actively maintained, supports bilibili.com and
# b23.tv short links out of the box).
RUN pip3 install --break-system-packages --no-cache-dir yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN npm run build

ENV PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "./node_modules/.bin/next start -p ${PORT:-10000}"]
