using UnityEngine;

public class FlickerLight : MonoBehaviour
{
    public float minimum = 0.35f;
    public float maximum = 1.1f;
    public float speed = 8f;

    private Light source;
    private float seed;

    private void Awake()
    {
        source = GetComponent<Light>();
        seed = Random.value * 100f;
    }

    private void Update()
    {
        if (source == null) return;
        float noise = Mathf.PerlinNoise(seed, Time.time * speed);
        source.intensity = Mathf.Lerp(minimum, maximum, noise);
    }
}

public class SpiderHazard : MonoBehaviour
{
    private Vector3 center;
    private float angle;

    private void Start()
    {
        center = transform.position;
        angle = Random.value * Mathf.PI * 2f;
    }

    private void Update()
    {
        angle += Time.deltaTime * 0.9f;
        transform.position = center + new Vector3(Mathf.Cos(angle) * 0.55f, 0f, Mathf.Sin(angle * 0.8f) * 0.42f);
        transform.Rotate(0f, 90f * Time.deltaTime, 0f);
    }

    private void OnTriggerEnter(Collider other)
    {
        FirstPersonPlayer player = other.GetComponent<FirstPersonPlayer>();
        if (player == null) return;
        HorrorGameManager.Instance.ShowEvent("Algo se moveu aos seus pes.");
        HorrorGameManager.Instance.EmitNoise(transform.position, 13f);
    }
}
