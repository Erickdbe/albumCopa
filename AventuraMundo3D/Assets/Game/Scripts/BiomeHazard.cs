using UnityEngine;

namespace AventuraMundo
{
    public class BiomeHazard : MonoBehaviour
    {
        public float damagePerSecond = 8f;
        public float slowMultiplier = 0.65f;

        void OnTriggerStay(Collider other)
        {
            var player = other.GetComponentInParent<AdventureCharacterController>();
            if (player)
            {
                player.TakeDamage(damagePerSecond * Time.deltaTime);
            }
        }
    }
}
