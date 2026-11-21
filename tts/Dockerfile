# REGAM Live - the voice service: reads the translated sentences aloud, free, on this server (Piper).
# Author: Aziz Mernissi
FROM python:3.12-slim
RUN pip install --no-cache-dir piper-tts==1.8.0
WORKDIR /srv
COPY server.py .
ENV PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
