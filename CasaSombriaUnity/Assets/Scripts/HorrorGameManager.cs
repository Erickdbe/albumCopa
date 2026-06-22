using System;
using System.Collections;
using UnityEngine;
using UnityEngine.UI;

public class HorrorGameManager : MonoBehaviour
{
    public static HorrorGameManager Instance;
    public static event Action<Vector3, float> NoiseEmitted;

    public FirstPersonPlayer player;
    public GrannyAI granny;
    public Vector3 playerSpawn = new Vector3(55f, 8f, 18f);
    public Vector3 playerSpawnEuler = new Vector3(0f, -90f, 0f);

    public Text objectiveText;
    public Text inventoryText;
    public Text dayText;
    public Text promptText;
    public Text eventText;
    public Text presenceText;
    public Text endTitleText;
    public Text endCopyText;
    public GameObject startOverlay;
    public GameObject endOverlay;
    public GameObject hiddenIndicator;
    public Image damageFlash;

    public AudioClip ambientClip;
    public AudioClip chaseClip;
    public AudioClip footstepClip;
    public AudioClip captureClip;
    public AudioClip secretClip;
    public AudioClip[] atmosphereClips;

    private AudioSource ambientSource;
    private AudioSource chaseSource;
    private AudioSource effectsSource;
    private PickupItem heldItem;
    private int day = 1;
    private bool playing;
    private bool transitioning;
    private bool boyRescued;
    private float eventUntil;
    private float atmosphereTimer = 18f;

    public bool IsPlaying
    {
        get { return playing && !transitioning; }
    }

    public bool HasHeldItem
    {
        get { return heldItem != null; }
    }

    public bool BoyRescued
    {
        get { return boyRescued; }
    }

    private void Awake()
    {
        Instance = this;
        ambientSource = CreateAudioSource(true, 0.32f);
        chaseSource = CreateAudioSource(true, 0.42f);
        effectsSource = CreateAudioSource(false, 0.72f);
        ambientSource.clip = ambientClip;
        chaseSource.clip = chaseClip;
    }

    private void Start()
    {
        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;
        startOverlay.SetActive(true);
        endOverlay.SetActive(false);
        hiddenIndicator.SetActive(false);
        damageFlash.color = new Color(0.55f, 0f, 0f, 0f);
        UpdateHud();
    }

    private void Update()
    {
        if (!playing)
        {
            if (startOverlay.activeSelf && (Input.GetMouseButtonDown(0) || Input.GetKeyDown(KeyCode.Return))) StartGame();
            return;
        }

        if (Input.GetKeyDown(KeyCode.Escape))
        {
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }
        else if (Input.GetMouseButtonDown(0) && Cursor.lockState != CursorLockMode.Locked && !transitioning)
        {
            LockCursor();
        }

        if (!string.IsNullOrEmpty(eventText.text) && Time.time > eventUntil) eventText.text = "";

        atmosphereTimer -= Time.deltaTime;
        if (atmosphereTimer <= 0f)
        {
            atmosphereTimer = UnityEngine.Random.Range(22f, 40f);
            if (atmosphereClips != null && atmosphereClips.Length > 0)
            {
                effectsSource.PlayOneShot(atmosphereClips[UnityEngine.Random.Range(0, atmosphereClips.Length)], 0.25f);
            }
        }
    }

    private AudioSource CreateAudioSource(bool loop, float volume)
    {
        AudioSource source = gameObject.AddComponent<AudioSource>();
        source.loop = loop;
        source.volume = volume;
        source.spatialBlend = 0f;
        source.playOnAwake = false;
        return source;
    }

    public void StartGame()
    {
        startOverlay.SetActive(false);
        endOverlay.SetActive(false);
        playing = true;
        transitioning = false;
        LockCursor();
        if (ambientSource.clip != null) ambientSource.Play();
        ShowEvent("Dia 1");
    }

    private void LockCursor()
    {
        Cursor.lockState = CursorLockMode.Locked;
        Cursor.visible = false;
    }

    public void PickUp(PickupItem item)
    {
        if (heldItem != null)
        {
            ShowEvent("Voce so consegue carregar um item.");
            return;
        }

        heldItem = item;
        item.gameObject.SetActive(false);
        EmitNoise(player.transform.position, 3f);
        ShowEvent(item.label + " coletado.");
        UpdateHud();
    }

    public bool UseHeldItem(string itemId, bool consume)
    {
        if (heldItem == null || heldItem.itemId != itemId) return false;
        if (consume)
        {
            Destroy(heldItem.gameObject);
            heldItem = null;
            UpdateHud();
        }
        return true;
    }

    public void DropHeldItem()
    {
        if (heldItem == null || player.IsHidden) return;
        PickupItem dropped = heldItem;
        heldItem = null;
        dropped.transform.position = player.transform.position + player.transform.forward * 1.15f + Vector3.up * 0.45f;
        dropped.gameObject.SetActive(true);
        Rigidbody body = dropped.GetComponent<Rigidbody>();
        if (body == null) body = dropped.gameObject.AddComponent<Rigidbody>();
        body.mass = 0.35f;
        body.AddForce(player.transform.forward * 1.8f, ForceMode.VelocityChange);
        EmitNoise(dropped.transform.position, 12f);
        ShowEvent("O item caiu no chao.");
        UpdateHud();
    }

    public void EmitNoise(Vector3 position, float radius)
    {
        if (NoiseEmitted != null) NoiseEmitted(position, radius);
    }

    public void SetPrompt(string value)
    {
        promptText.text = value;
    }

    public void SetHidden(bool value)
    {
        hiddenIndicator.SetActive(value);
        presenceText.text = value ? "Escondido" : "Escutando...";
        if (value) SetChase(false);
    }

    public void SetChase(bool value)
    {
        if (value)
        {
            presenceText.text = "Ela viu voce";
            if (!chaseSource.isPlaying && chaseSource.clip != null) chaseSource.Play();
        }
        else
        {
            if (!player.IsHidden) presenceText.text = "Escutando...";
            if (chaseSource.isPlaying) chaseSource.Stop();
        }
    }

    public void ShowEvent(string message)
    {
        eventText.text = message;
        eventUntil = Time.time + 2.8f;
    }

    public void PlayOneShot(AudioClip clip)
    {
        if (clip != null) effectsSource.PlayOneShot(clip);
    }

    public void PlaySecret()
    {
        PlayOneShot(secretClip);
    }

    public void PlayFootstep()
    {
        if (footstepClip != null && !effectsSource.isPlaying) effectsSource.PlayOneShot(footstepClip, 0.22f);
    }

    public void RescueBoy()
    {
        boyRescued = true;
        ShowEvent("A crianca saiu da cela.");
        PlaySecret();
        UpdateHud();
    }

    public void WinGame()
    {
        if (!boyRescued)
        {
            ShowEvent("Voce nao pode sair sem a crianca.");
            return;
        }
        FinishGame(true);
    }

    public void CapturePlayer()
    {
        if (transitioning || !playing) return;
        StartCoroutine(CaptureRoutine());
    }

    private IEnumerator CaptureRoutine()
    {
        transitioning = true;
        SetChase(false);
        PlayOneShot(captureClip);
        float elapsed = 0f;
        while (elapsed < 0.7f)
        {
            elapsed += Time.deltaTime;
            damageFlash.color = new Color(0.55f, 0f, 0f, Mathf.Clamp01(elapsed / 0.4f));
            yield return null;
        }

        yield return new WaitForSeconds(0.6f);
        if (day >= 5)
        {
            FinishGame(false);
            yield break;
        }

        day++;
        if (heldItem != null) DropHeldItemAt(player.transform.position);
        player.ResetForDay(playerSpawn, Quaternion.Euler(playerSpawnEuler));
        granny.ResetEnemy();
        UpdateHud();

        elapsed = 0f;
        while (elapsed < 1f)
        {
            elapsed += Time.deltaTime;
            damageFlash.color = new Color(0.55f, 0f, 0f, 1f - elapsed);
            yield return null;
        }

        transitioning = false;
        LockCursor();
        ShowEvent("Dia " + day);
    }

    private void DropHeldItemAt(Vector3 position)
    {
        PickupItem dropped = heldItem;
        heldItem = null;
        dropped.transform.position = position + Vector3.up * 0.4f;
        dropped.gameObject.SetActive(true);
    }

    private void FinishGame(bool escaped)
    {
        playing = false;
        transitioning = false;
        if (ambientSource.isPlaying) ambientSource.Stop();
        if (chaseSource.isPlaying) chaseSource.Stop();
        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;
        endTitleText.text = escaped ? "Voce escapou" : "A casa venceu";
        endCopyText.text = escaped ? "A porta principal se abriu. Voces estao livres." : "O quinto dia terminou.";
        endOverlay.SetActive(true);
    }

    private void UpdateHud()
    {
        dayText.text = "DIA " + day + " / 5";
        inventoryText.text = heldItem == null ? "MAO VAZIA" : heldItem.label.ToUpperInvariant();
        objectiveText.text = boyRescued ? "ENCONTRE A CHAVE MESTRA E SAIA" : "ENCONTRE A CRIANCA";
    }
}
