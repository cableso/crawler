import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import Bottleneck from "bottleneck";
import axios from "axios";
import { PineconeClient, Vector } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "langchain/document";
import { uuid } from "uuidv4";

type CrawlRequest = FastifyRequest<{
	Querystring: { url: string };
}>;

const root: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
	const truncateStringByBytes = (str: string, bytes: number) => {
		const enc = new TextEncoder();
		return new TextDecoder("utf-8").decode(enc.encode(str).slice(0, bytes));
	};

	const sliceIntoChunks = (arr: Vector[], chunkSize: number) => {
		return Array.from(
			{ length: Math.ceil(arr.length / chunkSize) },
			(_, i) => arr.slice(i * chunkSize, (i + 1) * chunkSize)
		);
	};

	let pinecone: PineconeClient | null = null;

	const initPineconeClient = async () => {
		pinecone = new PineconeClient();
		console.log("init pinecone");
		await pinecone.init({
			environment: process.env.PINECONE_ENVIRONMENT!,
			apiKey: process.env.PINECONE_API_KEY!,
		});
	};

	fastify.get(
		"/",
		async function (request: CrawlRequest, reply: FastifyReply) {
			let pages: Page[] = [];
			let urls: string[] = [];
			const pineconeIndexName = process.env.PINECONE_INDEX_NAME!;
			const { url } = request.query;

			if (!pinecone) {
				await initPineconeClient();
			}

			const indexes = pinecone && (await pinecone.listIndexes());
			if (!indexes?.includes(pineconeIndexName)) {
				throw new Error(`Index ${pineconeIndexName} does not exist`);
			}

			const response = await axios.get(
				process.env.BASE_URL + "/urls?url=" + url
			);
			urls = response.data;

			await Promise.all(
				urls.map(async (currentUrl) => {
					console.log(process.env.BASE_URL);
					const response = await axios.get(
						process.env.BASE_URL + "/page?url=" + currentUrl
					);
					pages = Object.values(response.data);
				})
			);

			const documents = await Promise.all(
				pages.map((row) => {
					const splitter = new RecursiveCharacterTextSplitter({
						chunkSize: 300,
						chunkOverlap: 20,
					});
					const docs = splitter.splitDocuments([
						new Document({
							pageContent: row.text,
							metadata: {
								url: row.url,
								text: truncateStringByBytes(row.text, 35000),
							},
						}),
					]);
					return docs;
				})
			);

			const index = pinecone && pinecone.Index(pineconeIndexName);

			console.log("CREATE EMBEDDINGS");

			const embedder = new OpenAIEmbeddings({
				modelName: "text-embedding-ada-002",
				openAIApiKey: process.env.OPENAI_API_KEY,
			});

			const limiter = new Bottleneck({
				minTime: 50,
			});

			let counter = 0;
			const getEmbedding = async (doc: Document) => {
				const embedding = await embedder.embedQuery(doc.pageContent);
				console.log(doc.pageContent);
				console.log("got embedding", embedding.length);
				process.stdout.write(
					`${Math.floor(
						(counter / documents.flat().length) * 100
					)}%\r`
				);
				counter = counter + 1;
				return {
					id: uuid(),
					values: embedding,
					metadata: {
						chunk: doc.pageContent,
						text: doc.metadata.text as string,
						url: doc.metadata.url as string,
					},
				} as Vector;
			};

			let vectors = [] as Vector[];
			const rateLimitedGetEmbedding = limiter.wrap(getEmbedding);

			vectors = (await Promise.all(
				documents.flat().map((doc) => rateLimitedGetEmbedding(doc))
			)) as unknown as Vector[];

			try {
				vectors = (await Promise.all(
					documents.flat().map((doc) => rateLimitedGetEmbedding(doc))
				)) as unknown as Vector[];
				const chunks = sliceIntoChunks(vectors, 10);
				console.log(chunks.length);

				try {
					await Promise.all(
						chunks.map(async (chunk) => {
							await index!.upsert({
								upsertRequest: {
									vectors: chunk as Vector[],
									namespace: "",
								},
							});
						})
					);
				} catch (e) {
					console.log(e);
				}
			} catch (e) {
				console.log(e);
			}
		}
	);
};

export default root;
