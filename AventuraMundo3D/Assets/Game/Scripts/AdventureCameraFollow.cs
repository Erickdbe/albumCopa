using UnityEngine;

namespace AventuraMundo
{
    public class AdventureCameraFollow : MonoBehaviour
    {
        public Transform target;
        public Vector3 offset = new Vector3(0f, 9.5f, -9.5f);
        public float followSpeed = 8f;
        public float lookHeight = 1.1f;

        void LateUpdate()
        {
            if (!target) return;
            var desired = target.position + offset;
            transform.position = Vector3.Lerp(transform.position, desired, 1f - Mathf.Exp(-followSpeed * Time.deltaTime));
            transform.LookAt(target.position + Vector3.up * lookHeight);
        }
    }
}
