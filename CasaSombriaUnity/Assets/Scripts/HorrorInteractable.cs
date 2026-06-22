using System.Collections;
using UnityEngine;

public abstract class HorrorInteractable : MonoBehaviour
{
    public string label = "Interagir";

    public virtual string Prompt
    {
        get { return label; }
    }

    public abstract void Interact(FirstPersonPlayer player);
}

public class PickupItem : HorrorInteractable
{
    public string itemId;

    public override void Interact(FirstPersonPlayer player)
    {
        HorrorGameManager.Instance.PickUp(this);
    }
}

public class LockedDoor : HorrorInteractable
{
    public string requiredItem;
    public bool consumeItem = true;
    public bool isExit;
    public bool rescuesBoy;
    public Vector3 openLocalPosition;
    public Vector3 openLocalEuler;
    public AudioClip openSound;

    private bool opened;

    public override void Interact(FirstPersonPlayer player)
    {
        if (opened) return;

        if (isExit && !HorrorGameManager.Instance.BoyRescued)
        {
            HorrorGameManager.Instance.ShowEvent("Voce nao pode sair sem a crianca.");
            return;
        }

        if (!string.IsNullOrEmpty(requiredItem) && !HorrorGameManager.Instance.UseHeldItem(requiredItem, consumeItem))
        {
            HorrorGameManager.Instance.ShowEvent("Esta trancada.");
            HorrorGameManager.Instance.EmitNoise(transform.position, 8f);
            return;
        }

        opened = true;
        StartCoroutine(OpenRoutine());
        HorrorGameManager.Instance.PlayOneShot(openSound);
        HorrorGameManager.Instance.EmitNoise(transform.position, 14f);

        if (rescuesBoy)
        {
            HorrorGameManager.Instance.RescueBoy();
        }
        else if (isExit)
        {
            HorrorGameManager.Instance.WinGame();
        }
        else
        {
            HorrorGameManager.Instance.ShowEvent("A porta abriu.");
        }
    }

    private IEnumerator OpenRoutine()
    {
        Vector3 startPosition = transform.localPosition;
        Quaternion startRotation = transform.localRotation;
        Quaternion endRotation = Quaternion.Euler(openLocalEuler);
        float elapsed = 0f;

        while (elapsed < 0.7f)
        {
            elapsed += Time.deltaTime;
            float t = Mathf.SmoothStep(0f, 1f, elapsed / 0.7f);
            transform.localPosition = Vector3.Lerp(startPosition, openLocalPosition, t);
            transform.localRotation = Quaternion.Slerp(startRotation, endRotation, t);
            yield return null;
        }

        Collider[] colliders = GetComponentsInChildren<Collider>();
        for (int i = 0; i < colliders.Length; i++) colliders[i].enabled = false;
    }
}

public class DrawerInteractable : HorrorInteractable
{
    public string requiredItem = "hammer";
    public PickupItem hiddenItem;

    private bool opened;

    public override void Interact(FirstPersonPlayer player)
    {
        if (opened) return;
        if (!HorrorGameManager.Instance.UseHeldItem(requiredItem, false))
        {
            HorrorGameManager.Instance.ShowEvent("A gaveta nao abre desse jeito.");
            HorrorGameManager.Instance.EmitNoise(transform.position, 6f);
            return;
        }

        opened = true;
        transform.localPosition += transform.forward * 0.65f;
        if (hiddenItem != null) hiddenItem.gameObject.SetActive(true);
        HorrorGameManager.Instance.ShowEvent("A gaveta se abriu.");
        HorrorGameManager.Instance.PlaySecret();
        HorrorGameManager.Instance.EmitNoise(transform.position, 13f);
    }
}

public class HidingSpot : HorrorInteractable
{
    public Transform hidePoint;
    public Transform exitPoint;

    public override void Interact(FirstPersonPlayer player)
    {
        player.EnterHidingSpot(this);
    }
}
