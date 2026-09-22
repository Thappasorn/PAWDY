FROM python:3.13-slim
WORKDIR /app
COPY app.py requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN mkdir -p /data
ENV PAWDY_DB_PATH=/data/pawdy_social.db
EXPOSE 8000
CMD ["python","app.py"]
