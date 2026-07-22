using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class SurvivalWeaponController : MonoBehaviour
    {
        [SerializeField] private Camera aimCamera;
        [SerializeField] private Transform weaponSocket;
        [SerializeField] private LayerMask hitMask = ~0;

        private SurvivalInventory inventory;
        private SurvivalItemDefinition equippedWeapon;
        private GameObject equippedVisual;
        private int ammoInMagazine;
        private float nextShotTime;

        public SurvivalItemDefinition EquippedWeapon => equippedWeapon;
        public int AmmoInMagazine => ammoInMagazine;

        private void Awake()
        {
            inventory = GetComponent<SurvivalInventory>();

            if (aimCamera == null)
            {
                aimCamera = GetComponentInChildren<Camera>();
            }

            if (weaponSocket == null)
            {
                var socket = new GameObject("WeaponSocket");
                socket.transform.SetParent(transform, false);
                socket.transform.localPosition = new Vector3(0.42f, 1.35f, 0.58f);
                socket.transform.localRotation = Quaternion.Euler(0f, 6f, 0f);
                weaponSocket = socket.transform;
            }
        }

        private void Update()
        {
            if (equippedWeapon == null)
            {
                return;
            }

            if (Input.GetMouseButton(0))
            {
                TryShoot();
            }

            if (Input.GetKeyDown(KeyCode.R))
            {
                TryReload();
            }
        }

        public void Equip(SurvivalItemDefinition weapon)
        {
            if (weapon == null || weapon.ItemType != SurvivalItemType.Weapon)
            {
                return;
            }

            equippedWeapon = weapon;
            ammoInMagazine = Mathf.Min(ammoInMagazine, equippedWeapon.MagazineSize);
            RebuildWeaponVisual();

            if (ammoInMagazine <= 0)
            {
                TryReload();
            }
        }

        public bool TryReload()
        {
            if (equippedWeapon == null || inventory == null || equippedWeapon.MagazineSize <= 0)
            {
                return false;
            }

            var needed = equippedWeapon.MagazineSize - ammoInMagazine;
            if (needed <= 0 || string.IsNullOrEmpty(equippedWeapon.CompatibleAmmoId))
            {
                return false;
            }

            var available = inventory.GetQuantity(equippedWeapon.CompatibleAmmoId);
            var loaded = Mathf.Min(needed, available);
            if (loaded <= 0 || !inventory.TryConsume(equippedWeapon.CompatibleAmmoId, loaded))
            {
                return false;
            }

            ammoInMagazine += loaded;
            return true;
        }

        private void TryShoot()
        {
            if (Time.time < nextShotTime)
            {
                return;
            }

            if (equippedWeapon.MagazineSize > 0)
            {
                if (ammoInMagazine <= 0)
                {
                    TryReload();
                    return;
                }

                ammoInMagazine--;
            }

            nextShotTime = Time.time + equippedWeapon.FireRate;

            var origin = aimCamera != null ? aimCamera.transform.position : transform.position + Vector3.up * 1.5f;
            var direction = aimCamera != null ? aimCamera.transform.forward : transform.forward;
            if (Physics.Raycast(origin, direction, out var hit, equippedWeapon.Range, hitMask, QueryTriggerInteraction.Ignore))
            {
                var health = hit.collider.GetComponentInParent<SurvivalHealth>();
                if (health != null)
                {
                    health.Damage(equippedWeapon.Damage, gameObject);
                }
            }

            Debug.DrawRay(origin, direction * equippedWeapon.Range, Color.red, 0.08f);
        }

        private void RebuildWeaponVisual()
        {
            if (equippedVisual != null)
            {
                Destroy(equippedVisual);
            }

            if (weaponSocket == null || equippedWeapon == null || equippedWeapon.WorldModel == null)
            {
                return;
            }

            equippedVisual = Instantiate(equippedWeapon.WorldModel, weaponSocket);
            equippedVisual.transform.localPosition = Vector3.zero;
            equippedVisual.transform.localRotation = Quaternion.identity;
            equippedVisual.transform.localScale = Vector3.one * 0.38f;
        }
    }
}
