// Guestbook Generator functionality
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('guestbook-form');
    const resultDiv = document.getElementById('guestbook-result');
    const copyButton = document.getElementById('copy-json');

    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const handle = document.getElementById('handle').value;
            const message = document.getElementById('message').value;

            try {
                // Fetch the DID from the Bluesky API
                const response = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
                const data = await response.json();
                
                if (data.did) {
                    // Construct the guestbook JSON
                    const guestbookJson = {
                        "$type": "a.guestbook.i.signed",
                        "message": message,
                        "guestbook": `at://${data.did}/a.guestbook.for.my.pds/guestbook`
                    };

                    // Display the JSON
                    resultDiv.textContent = JSON.stringify(guestbookJson, null, 2);
                    resultDiv.style.display = 'block';
                    copyButton.style.display = 'block';
                } else {
                    resultDiv.textContent = 'Error: Could not resolve handle';
                    resultDiv.style.display = 'block';
                    copyButton.style.display = 'none';
                }
            } catch (error) {
                resultDiv.textContent = 'Error: ' + error.message;
                resultDiv.style.display = 'block';
                copyButton.style.display = 'none';
            }
        });
    }

    if (copyButton) {
        copyButton.addEventListener('click', function() {
            const jsonText = resultDiv.textContent;
            navigator.clipboard.writeText(jsonText).then(() => {
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy JSON';
                }, 2000);
            });
        });
    }
}); 