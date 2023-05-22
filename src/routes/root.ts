import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import Crawler from "crawler";
import TurndownService from "turndown";
import axios from "axios";

type CrawlRequest = FastifyRequest<{
	Querystring: { url: string };
}>;

const root: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
	const turndownService = new TurndownService();

	fastify.get(
		"/",
		async function (request: CrawlRequest, reply: FastifyReply) {
			const pages: string[] = [];
			let urls: string[] = [];
			const { url } = request.query;

			const response = await axios.get(
				process.env.BASE_URL + "/urls?url=" + url
			);
			urls = response.data;

			const crawler = new Crawler({
				rateLimit: 100,
				callback: async (error, res, done) => {
					if (error) {
						console.log(error);
					} else {
						const $ = res.$;
						const htmlContent = $("body").html();
						const markdown = turndownService.turndown(
							htmlContent || ""
						);

						pages.push(markdown);
						console.log(
							"Written " +
								pages.length +
								"/" +
								urls.length +
								" files"
						);
					}

					done();
				},
			});

			crawler.queue(urls);

			await new Promise((resolve) => {
				crawler.on("drain", function () {
					resolve(true);
				});
			});

			return reply.send({
				message:
					"Successfully crawled & saved " + urls.length + " pages",
			});
		}
	);
};

export default root;
