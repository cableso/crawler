import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import Crawler from "crawler";
import TurndownService from "turndown";

type CrawlRequest = FastifyRequest<{
	Querystring: { url: string };
}>;

const root: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
	fastify.get(
		"/",
		async function (request: CrawlRequest, reply: FastifyReply) {
			const turndownService = new TurndownService();
			const { url } = request.query;
			let page: Page | null = null;

			const crawler = new Crawler({
				rateLimit: 500,
				callback: async (error, res, done) => {
					if (error) {
						console.log(error);
					} else {
						const $ = res.$;
						const htmlContent = $("body").html();
						const markdown = turndownService.turndown(
							htmlContent || ""
						);

						page = {
							url: url,
							text: markdown,
						};
					}

					done();
				},
			});

			crawler.queue(url);

			await new Promise((resolve) => {
				crawler.on("drain", async function () {
					resolve(true);
				});
			});

			return reply.send({
				page: page,
			});
		}
	);
};

export default root;
