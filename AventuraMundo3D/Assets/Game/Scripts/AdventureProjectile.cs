using UnityEngine;

namespace AventuraMundo
{
    [RequireComponent(typeof(SphereCollider))]
    public class AdventureProjectile : MonoBehaviour
    {
        public Transform owner;
        public float speed = 10f;
        public float damage = 16f;
        public float lifetime = 2.8f;

        void Awake()
        {
            var col = GetComponent<SphereCollider>();
            col.isTrigger = true;
            col.radius = 0.22f;
        }

        void Update()
        {
            transform.position += transform.forward * speed * Time.deltaTime;
            lifetime -= Time.deltaTime;
            if (lifetime <= 0f) Destroy(gameObject);
        }

        void OnTriggerEnter(Collider other)
        {
            if (owner && other.transform.IsChildOf(owner)) return;

            var creature = other.GetComponentInParent<CreatureWanderer>();
            if (creature)
            {
                creature.TakeDamage(damage, owner);
                Destroy(gameObject);
                return;
            }

            if (!other.isTrigger && !other.GetComponentInParent<AdventureCharacterController>())
            {
                Destroy(gameObject);
            }
        }
    }
}
