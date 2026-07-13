using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class ArenaWorldMetadata : MonoBehaviour
    {
        public Transform[] playerSpawns = new Transform[0];
        public Transform[] vehicleSpawns = new Transform[0];
        public Transform[] lootSpawns = new Transform[0];
        public Transform[] eventAnchors = new Transform[0];

        public Vector2 playableBounds = new Vector2(240f, 240f);
        public string[] mapZones = { "City", "Forest", "Beach" };
    }
}
