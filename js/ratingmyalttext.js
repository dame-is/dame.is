import React, { useState } from "react";
import ReactDOM from "react-dom";
import NeedlePieChart from "ratemyalttext/components/NeedlePieChart.js";

const App = () => {
  const [username, setUsername] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const PUBLIC_API_URL = "https://public.api.bsky.app";

  const resolveHandleToDID = async (handle) => {
    const res = await fetch(
      `${PUBLIC_API_URL}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );
    const data = await res.json();
    if (!data.did) throw new Error(`Unable to resolve DID for handle: ${handle}`);
    return data.did;
  };

  const fetchServiceEndpoint = async (did) => {
    const res = await fetch(`https://plc.directory/${did}`);
    const data = await res.json();
    if (data.service?.length > 0) {
      return data.service[0].serviceEndpoint;
    }
    throw new Error(`Service endpoint not found for DID: ${did}`);
  };

  const fetchRecordsForCollection = async (serviceEndpoint, did, collectionName) => {
    let records = [];
    let cursor = null;

    do {
      const url = `${serviceEndpoint}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${collectionName}&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      records = records.concat(data.records || []);
      cursor = data.cursor || null;
    } while (cursor);

    return records;
  };

  const analyzePosts = (records) => {
    const postsWithImages = records.filter(
      (rec) => rec.value.embed && rec.value.embed["$type"] === "app.bsky.embed.images"
    );
    const postsWithAltText = postsWithImages.filter((rec) =>
      rec.value.embed.images.some((img) => img.alt && img.alt.trim())
    );

    return {
      totalPosts: records.length,
      postsWithImages: postsWithImages.length,
      postsWithAltText: postsWithAltText.length,
      altTextPercentage: (postsWithAltText.length / postsWithImages.length) * 100 || 0,
    };
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResults(null);

    try {
      const did = await resolveHandleToDID(username);
      const serviceEndpoint = await fetchServiceEndpoint(did);
      const records = await fetchRecordsForCollection(serviceEndpoint, did, "app.bsky.feed.post");
      const analysis = analyzePosts(records);
      setResults(analysis);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Bluesky Alt Text Analyzer</h1>
      <form onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Enter Bluesky username (e.g., dame.bsky.social)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <button type="submit">Search</button>
      </form>
      {loading && <p>Loading...</p>}
      {results && (
        <div>
          <h2>Results</h2>
          <p>Total Posts: {results.totalPosts}</p>
          <p>Posts with Images: {results.postsWithImages}</p>
          <p>Posts with Alt Text: {results.postsWithAltText}</p>
          <p>Alt Text Usage: {results.altTextPercentage.toFixed(2)}%</p>
          <NeedlePieChart value={results.altTextPercentage} />
        </div>
      )}
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById("root"));
