import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import RobotsParser from "robots-parser";
import axios from "axios";
import cheerio from "cheerio";

type CrawlRequest = FastifyRequest<{
	Querystring: { url: string };
}>;

const root: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
	fastify.get(
		"/",
		async function (request: CrawlRequest, reply: FastifyReply) {
			const { url } = request.query;

			// Fetch and parse robots.txt
			const robotsResponse = await axios.get(`${url}/robots.txt`);
			const robotsTxt = robotsResponse.data;
			const robots = RobotsParser(`${url}/robots.txt`, robotsTxt);

			// Start with sitemaps from robots.txt
			let sitemaps = robots.getSitemaps();

			// If no sitemaps found, try common sitemap location
			if (sitemaps.length === 0) {
				try {
					await axios.head(`${url}/sitemap.xml`);
					// If request doesn't fail, add to sitemaps
					sitemaps.push(`${url}/sitemap.xml`);
				} catch (error) {
					console.log("No sitemap found at common location");
				}
			}

			// Fetch all urls from all sitemaps
			const urls: string[] = [];
			await Promise.all(
				sitemaps.map(async (sitemapIndex) => {
					const response = await axios.get(sitemapIndex);

					const $ = cheerio.load(response.data, {
						xmlMode: true,
					});

					// First, check if it's a sitemap index
					if ($("sitemapindex").length > 0) {
						// It's a sitemap index, get individual sitemaps
						const sitemaps: string[] = [];
						$("sitemap loc").each(function (this: cheerio.Element) {
							const sitemapUrl = $(this).text();
							sitemaps.push(sitemapUrl);
						});

						// Fetch individual sitemaps
						await Promise.all(
							sitemaps.map(async (sitemapUrl) => {
								const sitemapResponse = await axios.get(
									sitemapUrl
								);

								const sitemap$ = cheerio.load(
									sitemapResponse.data,
									{
										xmlMode: true,
									}
								);

								sitemap$("url loc").each(function (
									this: cheerio.Element
								) {
									const url = sitemap$(this).text();
									if (robots.isAllowed(url)) {
										urls.push(url);
									}
								});
							})
						);
					} else {
						// It's not a sitemap index, so fetch URLs directly
						$("url loc").each(function (this: cheerio.Element) {
							const url = $(this).text();
							if (robots.isAllowed(url)) {
								urls.push(url);
							}
						});
					}
				})
			);

			return urls;
		}
	);
};

export default root;
