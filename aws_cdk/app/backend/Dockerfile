FROM public.ecr.aws/lambda/nodejs:18

COPY package*.json ./
RUN npm install

COPY . .

CMD [ "index.handler" ]
