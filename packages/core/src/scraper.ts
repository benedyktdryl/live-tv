/**
 * @deprecated Prefer `./connectors/livetv.js` parsers or `./aggregator.js` for fetching.
 */
export {
  fetchLivetvEvents,
  fetchLivetvEventDetail,
  parseEventListFromHtml,
  parseStreamLinksFromHtml,
  parseEventDate,
  absoluteUrl,
  livetvConnector,
  LIVETV_SOURCE_ID,
} from "./connectors/livetv.js";
