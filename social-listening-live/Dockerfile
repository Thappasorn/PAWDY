FROM python:3.13-slim
WORKDIR /build
COPY app.tgz.b64 ./
RUN base64 -d app.tgz.b64 > app.tgz \
 && echo "768f3a46bfbea2265bea3a4154b7929b138fa4ae062043775852c6eb218567cf  app.tgz" | sha256sum -c - \
 && mkdir -p /opt/pawdy \
 && tar -xzf app.tgz -C /opt/pawdy \
 && pip install --no-cache-dir -r /opt/pawdy/pawdy-social-listening-live/requirements.txt \
 && rm -rf /build/*
WORKDIR /opt/pawdy/pawdy-social-listening-live
RUN mkdir -p /data
ENV PAWDY_DB_PATH=/data/pawdy_social.db
EXPOSE 8000
CMD ["python","app.py"]
