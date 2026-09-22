FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY app.part* ./
RUN cat app.part1 app.part2 app.part3 app.part4 app.part5 app.part6 | base64 -d > app.zip \
 && unzip -q app.zip -d /opt/pawdy \
 && pip install --no-cache-dir -r /opt/pawdy/pawdy-social-listening-live/requirements.txt \
 && rm -rf /build/*
WORKDIR /opt/pawdy/pawdy-social-listening-live
RUN mkdir -p /data
ENV PAWDY_DB_PATH=/data/pawdy_social.db
EXPOSE 8000
CMD ["python","app.py"]
