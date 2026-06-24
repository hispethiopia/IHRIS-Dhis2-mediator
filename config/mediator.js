// config/mediator.js — OpenHIM mediator registration descriptor
// MEDIATOR_HOST allows overriding "localhost" when OpenHIM runs in Docker
// and can't reach the host via localhost. Set to the host's IP, e.g. 172.17.0.1
const MEDIATOR_HOST = process.env.MEDIATOR_HOST || "localhost";

module.exports = {
  urn: "urn:mediator:ihris-dhis2-hrh",
  version: "1.0.0",
  name: "iHRIS → DHIS2 HRH Mediator",
  description: "Pulls HRH data from iHRIS v5 FHIR API and pushes aggregate data to DHIS2",
  defaultChannelConfig: [
    {
      name: "iHRIS DHIS2 HRH Sync",
      urlPattern: "^/sync-hrh$",
      routes: [
        {
          name: "iHRIS DHIS2 HRH Route",
          host: MEDIATOR_HOST,
          port: process.env.MEDIATOR_PORT || 3000,
          path: "/sync-hrh",
          primary: true,
          type: "http",
        },
      ],
      allow: ["admin"],
      methods: ["GET", "POST"],
      type: "http",
    },
  ],
  endpoints: [
    {
      name: "Sync HRH Data",
      host: MEDIATOR_HOST,
      path: "/sync-hrh",
      port: process.env.MEDIATOR_PORT || 3000,
      primary: true,
      type: "http",
    },
  ],
  configDefs: [
    {
      param: "ihrisBaseUrl",
      displayName: "iHRIS Base URL",
      description: "Base URL of iHRIS v5 FHIR API",
      type: "string",
      default: "",
    },
    {
      param: "dhis2BaseUrl",
      displayName: "DHIS2 Base URL",
      description: "Base URL of DHIS2 API",
      type: "string",
      default: "",
    },
    {
      param: "period",
      displayName: "Reporting Period",
      description: "DHIS2 period (e.g. 202401 for Jan 2024)",
      type: "string",
      default: "",
    },
  ],
};
