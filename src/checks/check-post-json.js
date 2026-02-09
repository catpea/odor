export default function checkPostJson() {
  const required = ['guid', 'id', 'title', 'date', 'chapter'];

  return (send, packet) => {
    const { postData, postId } = packet;
    packet._complaints = packet._complaints || [];

    for (const field of required) {
      if (postData[field] == null || postData[field] === '') {
        packet._complaints.push(`[post.json] missing or empty "${field}"`);
      }
    }

    if (postData.date && isNaN(new Date(postData.date).getTime())) {
      packet._complaints.push(`[post.json] invalid date "${postData.date}"`);
    }

    if (postData.guid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postData.guid)) {
      packet._complaints.push(`[post.json] guid is not a valid UUID`);
    }

    send(packet);
  };
}
